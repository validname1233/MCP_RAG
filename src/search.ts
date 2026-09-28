// src/search.ts —— 检索服务：kb_search 的核心实现（出库主链路）。
// 时序（方案 §6.3 / 出库流程讨论定稿）：
//   query embedding（智谱）→ LanceDB 向量召回（scope 过滤 + searchable 核对）
//   → SQLite chunks 取原文 → 拼装"面包屑 + 原文 + 来源"文本块。
// FTS5 关键词通道与 RRF 融合是预留的叠加项（通道内加函数、拼装前融合，此处不动）。

import { db } from "./db.ts";
import { embedBatch } from "./embed.ts";
import { vectorStore } from "./vector-store.ts";

export interface SearchHit {
  entryId: number;
  idx: number;
  filename: string;
  heading: string;
  text: string;
  score: number;
}

const SCOPE_RE = /^kb:(group|c2c):[A-Za-z0-9_-]+$/;

export async function kbSearch(scope: string, query: string, topK: number): Promise<SearchHit[]> {
  if (!SCOPE_RE.test(scope)) throw new Error(`scope 格式不合法（收到 "${scope}"）`);

  // 1. 查询向量（单条走批量入口，语义同入库侧——同一模型同一维度保证向量空间一致）
  const { vectors: [queryVec], fake } = await embedBatch([query]);
  if (fake) throw new Error("embedding 未配置（EMBEDDING_API_KEY 为空），无法做语义检索");

  // 2. 向量召回：LanceDB scope 过滤 + SQLite searchable 核对（多取一倍已在内处理）
  // topK 上限默认 20；两阶段检索（召回扩窗→rerank）实验时用 KB_MAX_TOPK 放开。
  const maxTopK = Number(process.env.KB_MAX_TOPK ?? 20);
  const hits = await vectorStore.search(scope, queryVec, Math.max(1, Math.min(topK, maxTopK)));
  if (hits.length === 0) return [];

  // 3. 回 SQLite 取原文（复合键 (entry_id, idx) 批量取，单一数据源）
  const keys = hits.map((h) => `(${h.entryId}, ${h.idx})`).join(", ");
  const rows = db.prepare(
    `SELECT c.entry_id, c.idx, c.heading, c.text, e.filename
     FROM chunks c JOIN entries e ON e.id = c.entry_id
     WHERE (c.entry_id, c.idx) IN (${keys})`,
  ).all() as Array<{ entry_id: number; idx: number; heading: string; text: string; filename: string }>;
  const byKey = new Map(rows.map((r) => [`${r.entry_id}:${r.idx}`, r]));

  // 4. 拼装（保持召回排序；score 是 L2 距离，越小越相关）
  return hits
    .map((h) => {
      const row = byKey.get(`${h.entryId}:${h.idx}`);
      if (row === undefined) return null; // 原文已被删（孤儿向量未及清理的窗口期）
      return { entryId: h.entryId, idx: h.idx, filename: row.filename, heading: row.heading, text: row.text, score: h.score };
    })
    .filter((h): h is SearchHit => h !== null);
}

// MCP 工具的文本形态：每条 = 来源行 + 原文（模型友好的自含块）
export function formatHitsForModel(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return "知识库中没有检索到相关内容。可能原因：该会话还没上传过文档，或文档还在处理中。";
  }
  return hits
    .map((h, i) => {
      const source = h.heading !== "" ? `《${h.filename}》· ${h.heading}` : `《${h.filename}》`;
      return `【${i + 1}】${source}\n${h.text}`;
    })
    .join("\n\n");
}
