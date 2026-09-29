// src/fts.ts —— 关键词通道：FTS5 全文检索（BM25 排序）。
// 与向量通道（vector-store.ts）同款接口形状：scope 隔离 + searchable 核对，
// 返回 (entryId, idx, score) 由调用方回表取原文。两者弱项互补——向量管语义
// 相似，FTS 管字面精确（专名/编号/组合字符串；向量通道 7 条硬 miss 的画像）。
// trigram 分词器 = 三字滑窗，中文子串直接可查；代价是 <3 字的 query 无 trigram
// 可匹配——短 query 退化为 LIKE 前缀包含（家用量级可接受，超出再议）。

import { db } from "./db.ts";

export interface FtsHit {
  entryId: number;
  idx: number;
  score: number; // BM25 分数，越小越相关（FTS5 的 rank 惯例，与 L2 同向）
}

// 中文 query 没有空白分词——按段短语匹配会让整句变成"连续子串匹配"，语义
// 改写过的 query（我们的 gold 正是如此）几乎必然空手（eval 全零的根因）。
// 无分词器的标准做法：query 提取 trigram 集合做 OR 匹配，BM25 把"覆盖 query
// 更多 trigram"的块排前——字面相关性的排序语义天然成立。多段（含空格的
// query）trigram 合并进同一集合（AND 语义由 BM25 排序近似承担）。
function extractTrigrams(query: string): string[] {
  const segs = query.trim().split(/\s+/).filter(s => s.length >= 3);
  const grams = new Set<string>();
  for (const seg of segs) {
    for (let i = 0; i + 3 <= seg.length; i += 3) {  // 不重叠滑窗（步长 3），省查询 token
      grams.add(seg.slice(i, i + 3));
    }
  }
  return [...grams];
}

export function ftsSearch(scope: string, query: string, topK: number): FtsHit[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  // 没有任何可用的 trigram（全是 <3 字的段）：退化到 LIKE 包含（全表扫，
  // 量小可接受），保底"字面在不在"的语义
  const grams = extractTrigrams(trimmed);
  if (grams.length === 0) {
    const rows = db.prepare(
      `SELECT c.id, c.entry_id, c.idx FROM chunks c JOIN entries e ON e.id = c.entry_id
       WHERE e.scope = ? AND e.status = 'searchable' AND c.text LIKE ?
       LIMIT ?`,
    ).all(scope, `%${trimmed.replace(/[%_]/g, " ")}%`, Math.max(1, topK)) as Array<{ id: number; entry_id: number; idx: number }>;
    return rows.map((r) => ({ entryId: r.entry_id, idx: r.idx, score: 0 })); // 无排序依据，按表序
  }

  try {
    // trigram 间的双引号转义（正常输入不会有，防御 FTS5 语法注入）
    const match = grams.map(g => `"${g.replace(/"/g, '""')}"`).join(" OR ");
    const rows = db.prepare(
      `SELECT c.entry_id, c.idx, fts.rank
       FROM chunks_fts fts
       JOIN chunks c ON c.id = fts.rowid
       JOIN entries e ON e.id = c.entry_id
       WHERE chunks_fts MATCH ? AND e.scope = ? AND e.status = 'searchable'
       ORDER BY fts.rank
       LIMIT ?`,
    ).all(match, scope, Math.max(1, topK)) as Array<{ entry_id: number; idx: number; rank: number }>;
    return rows.map((r) => ({ entryId: r.entry_id, idx: r.idx, score: r.rank }));
  } catch (error) {
    // MATCH 语法极端 case 兜底：宁可空结果不让关键词通道炸检索
    console.error(`[fts] 查询失败（query="${trimmed.slice(0, 40)}"）：${error instanceof Error ? error.message : error}`);
    return [];
  }
}
