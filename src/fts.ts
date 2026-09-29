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

// query 消毒 + 组装：FTS5 语法里 " AND OR NOT ( ) * ^ : 是操作符，用户 query
// 原样拼接会语法错或语义劫持。做法：按空白分段，每段转义后独立包成短语
//（trigram 短语 = 子串匹配），段间 AND 连接——"多关键词各自命中"而非
// "整句连续出现"（用户 query 里的连接词/语序不应导致失配；冒烟实测抓过这个坑）。
function buildMatch(query: string): string {
  return query.trim().split(/\s+/)
    .map(seg => `"${seg.replace(/"/g, '""')}"`)
    .join(" AND ");
}

// 有效段：≥3 字才有 trigram 可匹配（太短的段进 MATCH 会拖垮查询或恒空）
function usableSegments(query: string): string[] {
  return query.trim().split(/\s+/).filter(seg => seg.replace(/\s+/g, "").length >= 3);
}

export function ftsSearch(scope: string, query: string, topK: number): FtsHit[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  // 所有段都 <3 字：没有 trigram 可用——退化到 LIKE 包含（全表扫，量小可接受），
  // 保底"字面在不在"的语义
  const segs = usableSegments(trimmed);
  if (segs.length === 0) {
    const rows = db.prepare(
      `SELECT c.id, c.entry_id, c.idx FROM chunks c JOIN entries e ON e.id = c.entry_id
       WHERE e.scope = ? AND e.status = 'searchable' AND c.text LIKE ?
       LIMIT ?`,
    ).all(scope, `%${trimmed.replace(/[%_]/g, " ")}%`, Math.max(1, topK)) as Array<{ id: number; entry_id: number; idx: number }>;
    return rows.map((r) => ({ entryId: r.entry_id, idx: r.idx, score: 0 })); // 无排序依据，按表序
  }

  try {
    const rows = db.prepare(
      `SELECT c.entry_id, c.idx, fts.rank
       FROM chunks_fts fts
       JOIN chunks c ON c.id = fts.rowid
       JOIN entries e ON e.id = c.entry_id
       WHERE chunks_fts MATCH ? AND e.scope = ? AND e.status = 'searchable'
       ORDER BY fts.rank
       LIMIT ?`,
    ).all(segs.map(seg => `"${seg.replace(/"/g, '""')}"`).join(" AND "), scope, Math.max(1, topK)) as Array<{ entry_id: number; idx: number; rank: number }>;
    return rows.map((r) => ({ entryId: r.entry_id, idx: r.idx, score: r.rank }));
  } catch (error) {
    // MATCH 语法极端 case 兜底：宁可空结果不让关键词通道炸检索
    console.error(`[fts] 查询失败（query="${trimmed.slice(0, 40)}"）：${error instanceof Error ? error.message : error}`);
    return [];
  }
}
