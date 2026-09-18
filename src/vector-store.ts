// src/vector-store.ts —— 向量存储：LanceDB 实现（2026-09-18 从 SQLite JSON 桩切换）。
//
// 数据布局：data/vectors.lance/ 目录（备份 = 拷目录，与 kb.sqlite 并排）。
// 表结构：vector(1024d) + entry_id + idx + scope —— scope 作为列使得租户隔离
// 在向量检索层就完成（.where 过滤），与 SQL 层的隔离双保险。
// 原文只存 SQLite chunks 表（单一数据源），这里只放向量与定位 id——召回后回
// SQLite 取内容拼装。
//
// 接口不变：upsert/remove/search 三个方法（worker/web 调用方零感知切换）。
// search 返回 (entryId, idx, score)——score 是 LanceDB 的 L2 距离（越小越近），
// 与桩时代的余弦相似度（越大越近）方向相反，kb_search 接入时注意排序语义。

import { join } from "node:path";
import { dirname, fileURLToPath } from "node:url";
import * as lancedb from "@lancedb/lancedb";
import { db } from "./db.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const TABLE = "chunks_vec";

// 单例连接：LanceDB connect 是轻量句柄，进程内共享一个（类比 SQLite 的 db 实例）
let tablePromise: Promise<lancedb.Table> | null = null;

async function getTable(): Promise<lancedb.Table> {
  if (tablePromise === null) {
    tablePromise = (async () => {
      const conn = await lancedb.connect(join(DATA_DIR, "vectors.lance"));
      const names = await conn.tableNames();
      if (!names.includes(TABLE)) {
        // 显式建表：占位行定 schema（1024 维 float 向量 + 定位 id + scope 列），建完即删
        const t = await conn.createTable(TABLE, [
          { vector: new Array(1024).fill(0), entry_id: -1, idx: -1, scope: "__schema__" },
        ]);
        await t.delete("entry_id = -1");
        return t;
      }
      return conn.openTable(TABLE);
    })();
  }
  return tablePromise;
}

export const vectorStore = {
  // 条目级 upsert：先删该条目旧行再插入（worker 重跑场景幂等）
  async upsert(scope: string, entryId: number, chunks: Array<{ index: number }>, vectors: number[][]): Promise<void> {
    const table = await getTable();
    await table.delete(`entry_id = ${entryId}`);
    const rows = vectors.map((v, i) => ({
      vector: v,
      entry_id: entryId,
      idx: chunks[i].index,
      scope,
    }));
    if (rows.length > 0) await table.add(rows);
  },

  async remove(entryId: number): Promise<void> {
    const table = await getTable();
    await table.delete(`entry_id = ${entryId}`);
  },

  // 语义检索：scope 过滤 + searchable 状态（LanceDB 不知 entries 状态，回 SQLite 核对）
  async search(scope: string, queryVector: number[], topK: number): Promise<Array<{ entryId: number; idx: number; score: number }>> {
    const table = await getTable();
    const hits = await table
      .search(queryVector)
      .where(`scope = '${scope.replace(/'/g, "''")}'`) // scope 是系统生成的安全字符集，转义为双保险
      .limit(topK * 2) // 多取一倍，searchable 过滤后再截断
      .toArray();
    if (hits.length === 0) return [];

    const ids = [...new Set(hits.map((h) => Number(h.entry_id)))];
    const placeholders = ids.map(() => "?").join(",");
    const valid = new Set(
      (db.prepare(`SELECT id FROM entries WHERE id IN (${placeholders}) AND status = 'searchable'`)
        .all(...ids) as Array<{ id: number }>).map((r) => r.id),
    );

    return hits
      .filter((h) => valid.has(Number(h.entry_id)))
      .slice(0, topK)
      .map((h) => ({ entryId: Number(h.entry_id), idx: Number(h.idx), score: Number(h._distance ?? 0) }));
  },
};
