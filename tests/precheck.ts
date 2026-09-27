// tests/precheck.ts —— gold 标注入库后预检器（跑 eval 前的最后一道闸）。
// 背景：pdf 题的 snippet 在本地按 pdf-parse 文本验证，线上入库走 MinerU
// （断行/空格/文本形态可能不同）；16 篇本地损坏件经 MinerU 复活后，全库
// snippet 唯一性结论也要对着真实库重验（三轮标注审查的共同结论）。
// 做三件事：
//   1. gold↔库对账：gold 文档必须存在且 status=searchable（比旧对账更严——
//      名字在但解析失败也算失败，eval 的对账已同步收紧）；
//   2. snippet 逐题块级核对，双口径：严格 includes + 空白压平 includes。
//      strict=0 而 flat>0 = 锚点跨了断行（需重锚）；两者都 0 = 文本形态不同
//      或缺失（需对着库里的真实文本重标）；
//   3. 唯一性重验：snippet 严格命中了哪些非 gold 文档的块（抢命中名单——
//      MinerU 复活文档可能带来新撞车）。
// 用法：KB_DATA_DIR=data-test node tests/precheck.ts [--gold=gold.json]
// 输出：控制台摘要 + tests/precheck-report.json。对账失败 exit 1（防止
// 在残库上白烧 eval 的 query embedding）；snippet 问题仅报告不拦截——
// 由人决定重锚还是接受。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_SCOPE = "kb:group:__ragtest__";
const args = process.argv.slice(2);
const goldFile = args.find((a) => a.startsWith("--gold="))?.slice(7) ?? "gold.json";
const goldPath = join(import.meta.dirname, goldFile);

interface GoldItem {
  id: string;
  query: string;
  gold: string[];
  type: "semantic" | "exact" | "none";
  answer_snippet?: string;
  note?: string;
}

let gold: GoldItem[];
try {
  gold = JSON.parse(readFileSync(goldPath, "utf8")) as GoldItem[];
} catch (error) {
  console.error(`[precheck] 读不到合法的 ${goldPath}：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

// ---- 动态加载（KB_DATA_DIR 已定）----
const { db } = await import("../src/db.ts");

// ---- 1. 对账：gold 文档必须 searchable（名字对不上或没入库成功都拦下）----
const entries = db.prepare(
  "SELECT id, filename FROM entries WHERE scope = ? AND status = 'searchable'",
).all(TEST_SCOPE) as Array<{ id: number; filename: string }>;
if (entries.length === 0) {
  console.error(`[precheck] 测试库里没有 ${TEST_SCOPE} 的 searchable 条目——先跑 ingest`);
  process.exit(1);
}
const idsByName = new Map(entries.map((e) => [e.filename.replace(/\.[^.]+$/, ""), e.id]));
const missing: string[] = [];
for (const g of gold) {
  for (const name of g.gold) {
    if (!idsByName.has(name)) missing.push(`${g.id}：${name}`);
  }
}
if (missing.length > 0) {
  console.error(`[precheck] ${missing.length} 个 gold 文档不在库内或未 searchable，中止：`);
  for (const m of missing) console.error(`  ✗ ${m}`);
  console.error("[precheck] 查 tests/ingest-report.json 的 failed 项——解析失败的文档名也在库里但不 searchable");
  process.exit(1);
}
console.log(`[precheck] 对账通过：${gold.length} 题 / 库内 ${entries.length} 个 searchable 条目`);

// ---- 2+3. 全库块文本一次载入，逐题核对 ----
const allChunks = db.prepare(
  `SELECT c.entry_id, c.text FROM chunks c JOIN entries e ON e.id = c.entry_id
   WHERE e.scope = ? AND e.status = 'searchable'`,
).all(TEST_SCOPE) as Array<{ entry_id: number; text: string }>;
const byId = new Map<number, string[]>();
for (const row of allChunks) {
  const list = byId.get(row.entry_id) ?? [];
  list.push(row.text);
  byId.set(row.entry_id, list);
}

const flat = (s: string) => s.replace(/\s+/g, "");
const results: Array<{
  id: string; snippet: string; verdict: "ok" | "reflow" | "missing";
  strictChunks: number; totalChunks: number; collidedDocs: string[];
}> = [];
let ok = 0, reflow = 0, missingSnip = 0, collisions = 0;

for (const g of gold) {
  if (g.answer_snippet === undefined || g.answer_snippet === "" || g.gold.length === 0) continue;
  const snip = g.answer_snippet;
  const snipFlat = flat(snip);
  const goldIds = g.gold.map((n) => idsByName.get(n)!);
  const totalChunks = goldIds.reduce((a, id) => a + (byId.get(id)?.length ?? 0), 0);
  const strictChunks = goldIds.reduce(
    (a, id) => a + (byId.get(id) ?? []).filter((t) => t.includes(snip)).length, 0);
  // 唯一性：非 gold 文档的块严格命中 = 抢命中
  const collidedDocs = new Set<string>();
  for (const e of entries) {
    if (goldIds.includes(e.id)) continue;
    if ((byId.get(e.id) ?? []).some((t) => t.includes(snip))) {
      collidedDocs.add(e.filename.replace(/\.[^.]+$/, ""));
    }
  }
  let verdict: "ok" | "reflow" | "missing" = "ok";
  if (strictChunks > 0) {
    if (collidedDocs.size > 0) collisions++;
  } else {
    const flatChunks = goldIds.reduce(
      (a, id) => a + (byId.get(id) ?? []).filter((t) => flat(t).includes(snipFlat)).length, 0);
    verdict = flatChunks > 0 ? "reflow" : "missing";
    if (verdict === "reflow") reflow++; else missingSnip++;
  }
  if (verdict === "ok") ok++;
  results.push({ id: g.id, snippet: snip, verdict, strictChunks, totalChunks, collidedDocs: [...collidedDocs] });
}

const report = { scope: TEST_SCOPE, generatedAt: new Date().toISOString(),
  summary: { checked: results.length, ok, reflow, missing: missingSnip, withCollisions: collisions },
  detail: results };
writeFileSync(join(import.meta.dirname, "precheck-report.json"), JSON.stringify(report, null, 2));

console.log(`[precheck] snippet 核对：${results.length} 题 → 正常 ${ok} / 断行错位 ${reflow} / 文本缺失 ${missingSnip} / 有抢命中 ${collisions}`);
for (const r of results) {
  if (r.verdict !== "ok") {
    console.log(`  ${r.verdict === "reflow" ? "↻" : "✗"} ${r.id}「${r.snippet.slice(0, 24)}」${r.verdict === "reflow" ? "锚点跨断行（压平后能找到）——需重锚" : "库内文本找不到——对照库里块文本重标"}`);
  }
  if (r.collidedDocs.length > 0) {
    console.log(`  ⚠ ${r.id}「${r.snippet.slice(0, 24)}」也被 ${r.collidedDocs.join("、")} 的块命中（抢命中）`);
  }
}
console.log(`[precheck] 报告 → tests/precheck-report.json`);
