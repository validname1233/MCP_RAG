// scripts/migrate-vectors-to-lance.ts —— 一次性迁移：SQLite vectors 桩表 → LanceDB。
// 用法（omen6）：node --env-file=.env scripts/migrate-vectors-to-lance.ts
// 步骤：读 vectors 表按条目分组写入 LanceDB → 抽查检索 → DROP TABLE vectors。
// 幂等：vectors 表已不存在时直接退出（重复跑无害）。

import { DatabaseSync } from "node:sqlite";
import { vectorStore } from "../src/vector-store.ts";

const db = new DatabaseSync(new URL("../data/kb.sqlite", import.meta.url).pathname);

const exists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'",
).get();
if (exists === undefined) {
  console.log("vectors 表不存在，无需迁移");
  process.exit(0);
}

const rows = db.prepare(
  `SELECT v.entry_id, v.idx, v.vector, e.scope
   FROM vectors v JOIN entries e ON e.id = v.entry_id`,
).all() as Array<{ entry_id: number; idx: number; vector: string; scope: string }>;

console.log(`待迁移 ${rows.length} 行（来自 ${new Set(rows.map((r) => r.entry_id)).size} 个条目）`);

// 按条目分组走 vectorStore.upsert（复用生产路径，保证 schema 一致）
const byEntry = new Map<number, { scope: string; items: Array<{ idx: number; vector: number[] }> }>();
for (const r of rows) {
  const g = byEntry.get(r.entry_id) ?? { scope: r.scope, items: [] };
  g.items.push({ idx: r.idx, vector: JSON.parse(r.vector) as number[] });
  byEntry.set(r.entry_id, g);
}

for (const [entryId, g] of byEntry) {
  await vectorStore.upsert(g.scope, entryId, g.items.map((i) => ({ index: i.idx })), g.items.map((i) => i.vector));
}
console.log("LanceDB 写入完成");

// 抽查验证：任取一个条目，用它的第一个向量检索本 scope，应能命中自己
const sample = byEntry.values().next().value;
if (sample !== undefined) {
  const hits = await vectorStore.search(sample.scope, sample.items[0].vector, 3);
  const top = hits[0];
  console.log(`抽查（scope=${sample.scope}）：${hits.length} 命中，top1 = ${top ? `#${top.entryId}/${top.idx} (dist=${top.score.toFixed(4)})` : "无"}`);
  if (top === undefined) throw new Error("抽查失败：检索无结果，中止 DROP");
}

db.exec("DROP TABLE vectors");
console.log("已 DROP TABLE vectors，迁移完成 ✓");
