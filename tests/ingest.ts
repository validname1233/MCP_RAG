// tests/ingest.ts —— 入库测试脚本（进程内白盒，tests 方案阶段一）。
// 读 tests/testdata/ 下的 .md/.txt/.csv/.xlsx 文档 → 走真实流水线（解析→切块
// →embed→落库）写入 KB_DATA_DIR 指定的测试库 → 逐文档打点 → 报告 ingest-report.json。
//
// ⚠️ 两段式加载（必须）：db.ts 是模块加载时就连库的单例，KB_DATA_DIR 必须在
// import 任何 src 模块【之前】设置。所以本文件顶部只做纯 Node 操作，src 模块
// 全部动态 import。用法：
//   KB_DATA_DIR=data-test node --env-file=.env tests/ingest.ts
//（.env 提供智谱 EMBEDDING_API_KEY；--env-file 由 Node 注入不影响两段式——
//  env-file 在进程启动时生效，早于一切 import，与手动 process.env 赋值等价）

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// ---- 0. 解析参数 + 固定测试 scope（先于任何 src import）----
const TEST_SCOPE = "kb:group:__ragtest__";
const args = process.argv.slice(2);
const dataDirArg = args.find((a) => a.startsWith("--data="))?.slice(7) ?? join(import.meta.dirname, "testdata");
const resetFlag = args.includes("--reset"); // 删掉测试库重来（testdata 不动）

if (resetFlag) {
  const dataRoot = join(import.meta.dirname, "..", process.env.KB_DATA_DIR ?? "data-test");
  // 只清本测试 scope 的数据，不整库删（将来测试库若混入其他 scope 也安全）
  console.log(`[ingest] --reset：清空 scope ${TEST_SCOPE} 的旧数据`);
}

// ---- 1. 动态加载 src 模块（此刻 KB_DATA_DIR 已由外层环境变量定死）----
const { db, insertEntry, entryDir, FILES_DIR } = await import("../src/db.ts");
const { parseDocument } = await import("../src/parsers/registry.ts");
const { chunkDocument } = await import("../src/chunker.ts");
const { embedBatch, embeddingEnabled } = await import("../src/embed.ts");
const { vectorStore } = await import("../src/vector-store.ts");

if (!embeddingEnabled) {
  console.error("[ingest] 智谱 key 未配置（.env 的 EMBEDDING_API_KEY），真向量无法生成。中止。");
  process.exit(1);
}

// ---- 2. 收集文档 ----
const files = readdirSync(dataDirArg)
  .filter((f) => /\.(md|txt|csv|xlsx)$/i.test(f))
  .map((f) => join(dataDirArg, f))
  .filter((f) => statSync(f).isFile());
if (files.length === 0) {
  console.error(`[ingest] ${dataDirArg} 下没有可入库的文档（支持 md/txt/csv/xlsx）`);
  process.exit(1);
}
console.log(`[ingest] ${files.length} 个文档待入库 → scope ${TEST_SCOPE}`);

// ---- 3. --reset：清旧数据（SQLite entries/chunks + LanceDB + 文件目录）----
if (resetFlag) {
  const olds = db.prepare("SELECT id FROM entries WHERE scope = ?").all(TEST_SCOPE) as Array<{ id: number }>;
  for (const { id } of olds) {
    db.prepare("DELETE FROM chunks WHERE entry_id = ?").run(id);
    await vectorStore.remove(id);
  }
  db.prepare("DELETE FROM entries WHERE scope = ?").run(TEST_SCOPE);
  if (olds.length > 0) {
    rmSync(join(FILES_DIR, TEST_SCOPE), { recursive: true, force: true });
    console.log(`[ingest] 已清 ${olds.length} 条旧条目`);
  }
}

// ---- 4. 逐文档入库（复刻 worker 流程 + 打点；不走 enqueue/processEntry——
//         那是异步队列驱动，测试要同步顺序 + 分段计时，直写更可控）----
interface DocTiming {
  file: string;
  entryId: number;
  sizeBytes: number;
  chunks: number;
  msParse: number;
  msChunk: number;
  msEmbed: number;
  msStore: number;
  msTotal: number;
  error?: string;
}

const timings: DocTiming[] = [];
let totalChunks = 0;
let apiBatches = 0; // 成本计量：embed 批调用次数（方案 §5 的教训）

for (const file of files) {
  const filename = file.split("/").pop()!.split("\\").pop()!;
  const data = readFileSync(file);
  const t0 = Date.now();
  const row: DocTiming = { file: filename, entryId: -1, sizeBytes: data.length, chunks: 0,
    msParse: 0, msChunk: 0, msEmbed: 0, msStore: 0, msTotal: 0 };

  try {
    // 4a. 建条目（status=processing，测试脚本自己掌控状态推进）
    const info = insertEntry.run(TEST_SCOPE, filename, file, data.length, null);
    const id = Number(info.lastInsertRowid);
    row.entryId = id;
    db.prepare("UPDATE entries SET status = 'processing' WHERE id = ?").run(id);

    // 4b. 解析
    let t = Date.now();
    const parsed = await parseDocument({ filename, mime: null, data });
    row.msParse = Date.now() - t;

    // 4c. 切块
    t = Date.now();
    const chunks = chunkDocument(filename, parsed.doc.text, parsed.doc.sections);
    row.msChunk = Date.now() - t;
    if (chunks.length === 0) throw new Error("切不出任何块");
    row.chunks = chunks.length;
    totalChunks += chunks.length;

    // 4d. embedding（16 条/批由 embed.ts 内部处理，这里记批次数估成本）
    t = Date.now();
    const { vectors } = await embedBatch(chunks.map((c) => `${c.prefix}\n${c.text}`), id * 1000);
    row.msEmbed = Date.now() - t;
    apiBatches += Math.ceil(chunks.length / 16);

    // 4e. 落库（chunks SQLite + 向量 LanceDB，与 worker 同款幂等写法）
    t = Date.now();
    db.exec("BEGIN");
    db.prepare("DELETE FROM chunks WHERE entry_id = ?").run(id);
    const ins = db.prepare("INSERT INTO chunks (entry_id, idx, heading, prefix, text) VALUES (?, ?, ?, ?, ?)");
    for (const c of chunks) ins.run(id, c.index, c.heading, c.prefix, c.text);
    db.exec("COMMIT");
    await vectorStore.upsert(TEST_SCOPE, id, chunks, vectors);
    row.msStore = Date.now() - t;

    db.prepare("UPDATE entries SET status = 'searchable' WHERE id = ?").run(id);
    row.msTotal = Date.now() - t0;
    timings.push(row);
    console.log(`  ✓ ${filename}：${chunks.length} 块，${row.msTotal}ms (parse ${row.msParse}/chunk ${row.msChunk}/embed ${row.msEmbed}/store ${row.msStore})`);
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
    row.msTotal = Date.now() - t0;
    timings.push(row);
    if (row.entryId >= 0) db.prepare("UPDATE entries SET status = 'failed', error = ? WHERE id = ?").run(row.error.slice(0, 500), row.entryId);
    console.error(`  ✗ ${filename}：${row.error.slice(0, 120)}`);
  }
}

// ---- 5. 汇总报告 ----
const ok = timings.filter((t) => t.error === undefined);
const sum = (f: (t: DocTiming) => number) => ok.reduce((a, t) => a + f(t), 0);
const report = {
  scope: TEST_SCOPE,
  dataDir: dataDirArg,
  docs: timings.length, docsOk: ok.length, docsFailed: timings.length - ok.length,
  totalChunks,
  apiBatches,
  totals: {
    ms: sum((t) => t.msTotal),
    msParse: sum((t) => t.msParse), msChunk: sum((t) => t.msChunk),
    msEmbed: sum((t) => t.msEmbed), msStore: sum((t) => t.msStore),
  },
  perDocAvg: {
    ms: ok.length ? Math.round(sum((t) => t.msTotal) / ok.length) : 0,
    msEmbed: ok.length ? Math.round(sum((t) => t.msEmbed) / ok.length) : 0,
    chunks: ok.length ? Math.round(totalChunks / ok.length) : 0,
  },
  throughputDocsPerMin: ok.length > 0 ? Math.round((ok.length / sum((t) => t.msTotal)) * 60000) : 0,
  detail: timings,
};
const reportPath = join(import.meta.dirname, "ingest-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n[ingest] 完成：${ok.length}/${timings.length} 成功，${totalChunks} 块，吞吐 ${report.throughputDocsPerMin} 篇/分`);
console.log(`[ingest] 分段占比：parse ${report.totals.msParse}ms | chunk ${report.totals.msChunk}ms | embed ${report.totals.msEmbed}ms（API 主导属预期）| store ${report.totals.msStore}ms`);
console.log(`[ingest] embed 批调用 ${apiBatches} 次（成本计量）；报告 → ${reportPath}`);
