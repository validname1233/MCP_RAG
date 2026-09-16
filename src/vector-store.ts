// src/vector-store.ts —— 向量存储抽象：当前 SQLite 桩实现，阶段二后段换 LanceDB。
// 接口先行：upsert/remove/search 三个方法就是 kb_search 需要的全部。
// 桩的 search 用暴力余弦（量小可接受），真实现换磁盘式索引后接口不变。

import { db } from "./db.ts";

export interface VectorHit {
  chunkId: number;
  score: number;
}

const insertVector = db.prepare(
  "INSERT INTO vectors (entry_id, idx, vector) VALUES (?, ?, ?)",
);

// chunks 表和 vectors 表由 db.ts 建表（阶段二新增）——这里只做读写
export const vectorStore = {
  async upsert(scope: string, entryId: number, chunks: Array<{ index: number }>, vectors: number[][]): Promise<void> {
    db.prepare("DELETE FROM vectors WHERE entry_id = ?").run(entryId);
    for (let i = 0; i < vectors.length; i++) {
      insertVector.run(entryId, chunks[i].index, JSON.stringify(vectors[i]));
    }
    void scope; // 桩：scope 隔离在 search 的 SQL join 里做；LanceDB 版本用作 filter 列
  },

  async remove(entryId: number): Promise<void> {
    db.prepare("DELETE FROM vectors WHERE entry_id = ?").run(entryId);
  },

  // 暴力余弦召回（桩实现）：join chunks 拿 scope 过滤。LanceDB 版本换 ANN 查询。
  async search(scope: string, queryVector: number[], topK: number): Promise<VectorHit[]> {
    const rows = db.prepare(
      `SELECT v.entry_id, v.idx, v.vector FROM vectors v
       JOIN entries e ON e.id = v.entry_id
       WHERE e.scope = ? AND e.status = 'searchable'`,
    ).all(scope) as Array<{ entry_id: number; idx: number; vector: string }>;

    const scored = rows.map((r) => ({
      chunkId: r.entry_id * 100000 + r.idx, // 桩：复合 id（entry*1e5+idx）；LanceDB 版用真 chunk id
      score: cosine(JSON.parse(r.vector) as number[], queryVector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  },
};

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
