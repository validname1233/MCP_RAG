// src/search.ts —— 检索服务：kb_search 的核心实现（出库主链路）。
// 时序（方案 §6.3 / 出库流程讨论定稿）：
//   query embedding（智谱）→ LanceDB 向量召回（scope 过滤 + searchable 核对）
//   → SQLite 取原文 → [可选 rerank 重排] → 拼装"面包屑 + 原文 + 来源"文本块。
// 两阶段架构（rerank 接入，2026-09-28）：候选窗口 KB_RERANK_CANDIDATES（默认 20，
// K 曲线甜蜜点，见 tests/docs/评测指标/2026-09-28-召回窗口K曲线.md）内逐对精排
// 取 topK。rerank 失败/未启用时回落向量顺序——检索永不因增强段挂掉。
// FTS5 关键词通道与 RRF 融合是预留的叠加项（通道内加函数、拼装前融合，此处不动）。

import { db } from "./db.ts";
import { embedBatch } from "./embed.ts";
import { vectorStore } from "./vector-store.ts";
import { rerank, rerankEnabled } from "./rerank.ts";
import { config } from "./config.ts";
import { ftsSearch } from "./fts.ts";

export interface SearchHit {
  entryId: number;
  idx: number;
  filename: string;
  heading: string;
  text: string;
  score: number;  // 向量通道 = L2 距离（越小越好）；rerank 后 = relevance（越大越好）——随通道切换
}

const SCOPE_RE = /^kb:(group|c2c):[A-Za-z0-9_-]+$/;

export async function kbSearch(scope: string, query: string, topK: number): Promise<SearchHit[]> {
  if (!SCOPE_RE.test(scope)) throw new Error(`scope 格式不合法（收到 "${scope}"）`);

  // 1+2. 召回：按通道分路。vector/hybrid 走向量（hybrid 尚未实现，当前等同
  // vector + rerank）；fts 纯关键词——跳过 query embedding（省一次 API 往返
  // ~200ms），BM25 直接拿候选。两路返回同款 (entryId, idx, score) 形状。
  const maxTopK = config.search.maxTopK;
  const candidates = rerankEnabled ? config.rerank.candidates : topK;
  const wantN = Math.max(1, Math.min(Math.max(topK, candidates), maxTopK));
  let hits: Array<{ entryId: number; idx: number; score: number }>;
  if (config.search.channel === "fts") {
    hits = ftsSearch(scope, query, wantN);
  } else {
    const { vectors: [queryVec], fake } = await embedBatch([query]);
    if (fake) throw new Error("embedding 未配置（EMBEDDING_API_KEY 为空），无法做语义检索");
    hits = await vectorStore.search(scope, queryVec, wantN);
  }
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
  const assembled = hits
    .map((h) => {
      const row = byKey.get(`${h.entryId}:${h.idx}`);
      if (row === undefined) return null; // 原文已被删（孤儿向量未及清理的窗口期）
      return { entryId: h.entryId, idx: h.idx, filename: row.filename, heading: row.heading, text: row.text, score: h.score };
    })
    .filter((h): h is SearchHit => h !== null);

  // 5. rerank 重排（可选增强段）：送 prefix+text（与入库 embedding 同源——面包屑
  //    参与向量，也参与重排，xlsx 行块的自含形态对精排理解尤其关键）。
  //    失败/未启用返回 null → 保持向量顺序原样返回。
  if (rerankEnabled && assembled.length > 1) {
    // prefix 未随查询取回（chunks 表有存但 SELECT 未取）——补取一次，轻量单查
    const texts = await loadPrefixedTexts(assembled);
    const results = await rerank(query, texts, topK);
    if (results !== null) {
      const reranked = results
        .map(r => ({ ...assembled[r.index]!, score: r.score }))  // score 语义切换为 relevance（越大越好）
        .slice(0, topK);
      return reranked;
    }
  }
  return assembled;
}

// 块的"向量同源文本"：prefix + "\n" + text（入库 embedBatch 用的同一拼接）。
// chunks 表存了 prefix 但 kbSearch 的主 SELECT 没取（返回对象不需要它）——这里
// 按复合键补取一次，只查候选窗口内的行（≤30 行，开销可忽略）。
async function loadPrefixedTexts(hits: SearchHit[]): Promise<string[]> {
  const keys = hits.map((h) => `(${h.entryId}, ${h.idx})`).join(", ");
  const rows = db.prepare(
    `SELECT entry_id, idx, prefix, text FROM chunks WHERE (entry_id, idx) IN (${keys})`,
  ).all() as Array<{ entry_id: number; idx: number; prefix: string; text: string }>;
  const byKey = new Map(rows.map((r) => [`${r.entry_id}:${r.idx}`, r]));
  return hits.map((h) => {
    const row = byKey.get(`${h.entryId}:${h.idx}`);
    return row === undefined ? h.text : (row.prefix !== "" ? `${row.prefix}\n${row.text}` : h.text);
  });
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
