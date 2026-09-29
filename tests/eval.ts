// tests/eval.ts —— 检索质量与延迟评测脚本（进程内白盒，tests 方案阶段一/二）。
// 读 tests/gold.json（query 中心标注：query + gold 文档名列表 + type + 可选
// answer_snippet）→ 逐条 kbSearch → 文档级 Recall@K / Precision@K / MRR +
// snippet 命中率 + 延迟 P50/P95 → 报告 eval-report.json（失败 case 明细供人工检视）。
//
// ⚠️ 两段式加载：同 ingest.ts——先设/读环境再动态 import src。
// 用法：KB_DATA_DIR=data-test node --env-file=.env tests/eval.ts [--k=1,3,5] [--channel=vector|rerank] [--gold=gold.json]
// channel：vector = 纯向量基线；rerank = 两阶段（召回窗口→智谱精排）；fts/hybrid 待 FTS5。
// --gold 指定标注文件（tests/ 目录下相对名）——分阶段跑库时用子集（如先只入
// md 时 --gold=gold-md.json），否则 pdf 题在对账处硬中止。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_SCOPE = "kb:group:__ragtest__";
const args = process.argv.slice(2);
const goldFile = args.find((a) => a.startsWith("--gold="))?.slice(7) ?? "gold.json";
// 通道：vector = 纯向量；rerank = 向量两阶段（provider 由 RERANK_PROVIDER 选）；
// fts = 纯关键词；hybrid = 双路 RRF 融合（无 rerank）；hybrid-rerank = 融合 + 精排。
const channel = args.find((a) => a.startsWith("--channel="))?.slice(10) ?? "vector";
if (channel === "rerank") {
  process.env.RERANK_PROVIDER = process.env.RERANK_PROVIDER ?? "ali";
  process.env.KB_RERANK_CANDIDATES = process.env.KB_RERANK_CANDIDATES ?? "20";
  process.env.KB_MAX_TOPK = process.env.KB_MAX_TOPK ?? "20";
} else if (channel === "vector" || channel === "fts") {
  process.env.RERANK_ENABLED = "0";
  if (channel === "fts") process.env.KB_CHANNEL = "fts";
} else if (channel === "hybrid" || channel === "hybrid-rerank") {
  process.env.KB_CHANNEL = "hybrid";
  process.env.KB_MAX_TOPK = process.env.KB_MAX_TOPK ?? "20";
  if (channel === "hybrid") process.env.RERANK_ENABLED = "0";
  else {
    process.env.RERANK_PROVIDER = process.env.RERANK_PROVIDER ?? "ali";
    process.env.KB_RERANK_CANDIDATES = process.env.KB_RERANK_CANDIDATES ?? "20";
  }
} else {
  console.error(`[eval] 未知通道 ${channel}（vector | rerank | fts | hybrid | hybrid-rerank）`);
  process.exit(1);
}
const kList = (args.find((a) => a.startsWith("--k="))?.slice(4) ?? "1,3,5").split(",").map(Number);
// ---- 标注文件结构 ----
interface GoldItem {
  id: string;
  query: string;
  gold: string[];              // 文档名（不含扩展名）列表；空数组 = 干扰题（无答案）
  type: "semantic" | "exact" | "none";
  answer_snippet?: string;     // 答案关键词——块级自动验证（出现在任一召回块文本中即命中）
  note?: string;
}

const goldPath = join(import.meta.dirname, goldFile);
let gold: GoldItem[];
try {
  gold = JSON.parse(readFileSync(goldPath, "utf8")) as GoldItem[];
} catch (error) {
  console.error(`[eval] 读不到合法的 ${goldPath}：${error instanceof Error ? error.message : error}`);
  console.error('[eval] 格式：[{"id":"Q1","query":"…","gold":["文档名"],"type":"semantic","answer_snippet":"…"}]');
  process.exit(1);
}
if (gold.length === 0) {
  console.error("[eval] gold.json 为空——先标注（见 docs/2026-09-19-RAG能力测试方案.md）");
  process.exit(1);
}
console.log(`[eval] ${gold.length} 条标注（semantic ${gold.filter(g => g.type === "semantic").length} / exact ${gold.filter(g => g.type === "exact").length} / none ${gold.filter(g => g.type === "none").length}）`);

// ---- 动态加载（KB_DATA_DIR 已定）----
const { kbSearch } = await import("../src/search.ts");
const { db } = await import("../src/db.ts");

// entry_id → 文档名（去扩展名）映射：评分对账用。只认 searchable——解析失败
// 的 entry 也在表里（ingest 先建条目后解析），放行会变成静默假 miss。
const nameById = new Map<number, string>(
  (db.prepare("SELECT id, filename FROM entries WHERE scope = ? AND status = 'searchable'").all(TEST_SCOPE) as Array<{ id: number; filename: string }>)
    .map((r) => [r.id, r.filename.replace(/\.[^.]+$/, "")]),
);
if (nameById.size === 0) {
  console.error(`[eval] 测试库里没有 ${TEST_SCOPE} 的条目——先跑 ingest`);
  process.exit(1);
}
console.log(`[eval] 库内 ${nameById.size} 个条目`);

// 单块/多块分桶依据（gold-review-round3.md 发现）：单块文档（短 md 常见）
// 的文档召回与 snippet 命中严格合一（唯一块必然含 snippet），两级指标退化为
// 一级——混在一起统计会让 snippet 命中率被"天然满分"拉高。分桶后多块桶才是
// 有区分度的口径（测"召回的块里有没有答案块"）。
const chunksPerDoc = new Map<string, number>(
  (db.prepare(
    "SELECT e.id, COUNT(c.id) AS n FROM entries e LEFT JOIN chunks c ON c.entry_id = e.id WHERE e.scope = ? GROUP BY e.id",
  ).all(TEST_SCOPE) as Array<{ id: number; n: number }>)
    .map((r) => [nameById.get(r.id) ?? `#${r.id}`, r.n]),
);

// ---- 标注对账：gold 文档名必须能在库内找到（防假 miss）----
// 手标 gold 最容易出的错是拼写/全半角/大小写不一致——名字对不上该题就永远
// 召回不了，整轮评测出假 miss 还以为是检索差。对不上就硬中止（在 warmup
// 之前，一次 query embedding 都不烧），逐条列出让人改 gold 或查入库失败。
const known = new Set(nameById.values());
const badGold: string[] = [];
for (const g of gold) {
  if (g.type !== "none" && g.gold.length === 0) badGold.push(`${g.id}：type=${g.type} 但 gold 为空`);
  for (const name of g.gold) {
    if (!known.has(name)) badGold.push(`${g.id}：gold「${name}」不在库内`);
  }
}
if (badGold.length > 0) {
  console.error(`[eval] gold.json 有 ${badGold.length} 处与库内文档对不上，中止：`);
  for (const b of badGold) console.error(`  ✗ ${b}`);
  console.error("[eval] gold 用「去扩展名的文件名」且须与库内完全一致（大小写/全半角/空格）；");
  console.error("[eval] 若名字没拼错，则是该文档没入库成功——查 tests/ingest-report.json 的 failed 项");
  process.exit(1);
}

// ---- warmup（20 条预热页缓存/句柄，不计入正式计时——方案阶段二）----
for (const g of gold.slice(0, 20)) {
  await kbSearch(TEST_SCOPE, g.query, 3).catch(() => undefined);
}
console.log("[eval] warmup 完成（20 条，不计入统计）");

// ---- 逐条检索 + 评分 ----
const MAXK = Math.max(...kList);
interface CaseResult extends GoldItem {
  ms: number;
  hits: Array<{ rank: number; doc: string; snippetHit: boolean }>;
  docRecall: boolean;   // top-K 内命中任一 gold（按最大 K 算，各 K 切片在汇总时做）
  firstGoldRank: number | null;
  singleChunk: boolean; // gold 全部为单块文档（文档召回≈snippet 命中，无区分度）
  firstSnipChunkRank: number | null; // 首个含 snippet 的块在【原始块级】结果里的位置（rerank 上限曲线用）
}

const results: CaseResult[] = [];
for (const g of gold) {
  const t0 = Date.now();
  const hits = await kbSearch(TEST_SCOPE, g.query, MAXK).catch((e: unknown) => {
    console.error(`  ✗ ${g.id} 检索异常：${e instanceof Error ? e.message : e}`);
    return [];
  });
  const ms = Date.now() - t0;

  // 文档级：召回块 → 所属文档名，按首现排名去重
  const seen = new Set<string>();
  const ranked: Array<{ rank: number; doc: string; snippetHit: boolean }> = [];
  for (const h of hits) {
    const doc = nameById.get(h.entryId) ?? `#${h.entryId}`;
    const snippetHit = g.answer_snippet !== undefined && h.text.includes(g.answer_snippet);
    if (!seen.has(doc)) {
      seen.add(doc);
      ranked.push({ rank: ranked.length + 1, doc, snippetHit });
    } else if (snippetHit) {
      // 同文档第二块才含 snippet：把 snippet 命中上提到该文档的首次出现
      const first = ranked.find((r) => r.doc === doc);
      if (first !== undefined) first.snippetHit = true;
    }
  }
  const goldSet = new Set(g.gold);
  const firstGold = ranked.find((r) => goldSet.has(r.doc)) ?? null;
  // 原始块级位置：首个含 snippet 的块在未去重的召回序列里排第几（与文档排名区分——
  // rerank 候选是块不是文档，上限曲线必须按块位算）
  const firstSnipChunkRank = g.answer_snippet !== undefined && g.answer_snippet !== ""
    ? (hits.findIndex((h) => h.text.includes(g.answer_snippet!)) + 1) || null
    : null;
  // 单块判定：gold 文档全部在库里只切出一块（gold 含多块文档时按多块算）
  const singleChunk = g.gold.length > 0 && g.gold.every((d) => (chunksPerDoc.get(d) ?? 0) <= 1);
  results.push({ ...g, ms, hits: ranked,
    docRecall: firstGold !== null, firstGoldRank: firstGold?.rank ?? null, singleChunk, firstSnipChunkRank });
}

// ---- 汇总（全体 + 按 type 分桶）----
function bucket(items: CaseResult[]) {
  const latencies = items.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => (latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]);
  const answered = items.filter((r) => r.gold.length > 0); // 有答案题（分母）
  const perK: Record<number, { recall: number; precision: number; snippet?: number }> = {};
  for (const k of kList) {
    let recalled = 0, precSum = 0, snipHit = 0;
    for (const r of answered) {
      const inTopK = r.hits.filter((h) => h.rank <= k);
      if (inTopK.some((h) => r.gold.includes(h.doc))) recalled++;
      precSum += inTopK.filter((h) => r.gold.includes(h.doc)).length / Math.max(k, 1);
      // snippet@K：首个含答案文本的块排进原始结果前 K（rerank 的召回上限）
      if (r.firstSnipChunkRank !== null && r.firstSnipChunkRank <= k) snipHit++;
    }
    perK[k] = {
      recall: answered.length ? +(recalled / answered.length).toFixed(4) : 0,
      precision: answered.length ? +(precSum / answered.length).toFixed(4) : 0,
      snippet: answered.length ? +(snipHit / answered.length).toFixed(4) : 0,
    };
  }
  const mrr = answered.length
    ? +(answered.reduce((a, r) => a + (r.firstGoldRank !== null ? 1 / r.firstGoldRank : 0), 0) / answered.length).toFixed(4)
    : 0;
  // snippet 命中率：有 snippet 的题里，top-K 任一召回块含答案关键词的比例
  const snip = items.filter((r) => r.answer_snippet !== undefined && r.answer_snippet !== "");
  const snipHit = snip.filter((r) => r.hits.some((h) => h.snippetHit)).length;
  // 空召回行为（干扰题应返回空/明确文案——这里看"是否一个都没召回"）
  const noneQ = items.filter((r) => r.gold.length === 0);
  const noneEmpty = noneQ.filter((r) => r.hits.length === 0).length;
  return {
    count: items.length,
    latency: { p50: pct(0.5), p95: pct(0.95), avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0 },
    perK, mrr,
    snippetRate: snip.length ? +(snipHit / snip.length).toFixed(4) : null,
    noneEmptyRate: noneQ.length ? +(noneEmpty / noneQ.length).toFixed(4) : null,
  };
}

const report = {
  scope: TEST_SCOPE, channel, kList,
  generatedAt: new Date().toISOString(),
  overall: bucket(results),
  byType: {
    semantic: bucket(results.filter((r) => r.type === "semantic")),
    exact: bucket(results.filter((r) => r.type === "exact")),
    none: bucket(results.filter((r) => r.type === "none")),
  },
  // 单块/多块分桶（gold-review-round3 建议）：单块文档文档召回≈snippet 命中
  // （唯一块必然含 snippet），是天然满分层；多块桶才测"答案块有没有跟上来"。
  byChunkiness: {
    singleChunk: bucket(results.filter((r) => r.singleChunk)),
    multiChunk: bucket(results.filter((r) => !r.singleChunk)),
  },
  // 失败 case 明细（有答案但 top-K 没召回的）——人工检视/FTS 立项证据
  misses: results
    .filter((r) => r.gold.length > 0 && r.firstGoldRank === null)
    .map((r) => ({ id: r.id, query: r.query, gold: r.gold, type: r.type,
      returned: r.hits.slice(0, 5).map((h) => h.doc), ms: r.ms })),
  // snippet 未命中明细（文档召回了、但答案块没进 top-K）——rerank 立项证据：
  // 这个差值 = "模型上下文里有正确文档、却没有答案文本"的比例
  snippetMisses: results
    .filter((r) => r.answer_snippet !== undefined && r.answer_snippet !== "" && r.firstGoldRank !== null
      && !r.hits.some((h) => h.snippetHit))
    .map((r) => ({ id: r.id, query: r.query, gold: r.gold, type: r.type,
      goldRank: r.firstGoldRank, singleChunk: r.singleChunk,
      returned: r.hits.slice(0, 5).map((h) => h.doc), ms: r.ms })),
};
const reportPath = join(import.meta.dirname, "eval-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n[eval] ── 全体（${report.overall.count} 题）──`);
console.log(`  延迟 P50 ${report.overall.latency.p50}ms / P95 ${report.overall.latency.p95}ms`);
for (const k of kList) console.log(`  Recall@${k} ${report.overall.perK[k].recall} | Precision@${k} ${report.overall.perK[k].precision}`);
console.log(`  MRR ${report.overall.mrr} | snippet 命中 ${report.overall.snippetRate} | 干扰题空召回 ${report.overall.noneEmptyRate}`);
console.log(`  分桶：semantic R@5 ${report.byType.semantic.perK[Math.max(...kList)]?.recall ?? "-"} / exact R@5 ${report.byType.exact.perK[Math.max(...kList)]?.recall ?? "-"}`);
console.log(`  块数分桶：单块题 ${report.byChunkiness.singleChunk.count} 个（snippet率 ${report.byChunkiness.singleChunk.snippetRate}）| 多块题 ${report.byChunkiness.multiChunk.count} 个（snippet率 ${report.byChunkiness.multiChunk.snippetRate}）——多块桶才是有区分度的口径`);
console.log(`  未命中 ${report.misses.length} 条（明细见报告）→ ${reportPath}`);
