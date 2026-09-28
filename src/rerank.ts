// src/rerank.ts —— 智谱 BigModel 文本重排序客户端（检索两阶段架构的第二段）。
// 背景与数据结构对齐见 tests/docs/技术讲解/2026-09-28-召回块数据结构与rerank接入.md：
// 向量召回（粗排）拿到候选窗口（K=20~30，K 曲线实测 @20 天花板 84.6%）→ 本模块
// 逐对精读 query↔候选文本打分 → 取 top-n。约束宽松：候选 ≤128 条、单条 ≤4096 字符
//（我们的块 ≤900 字），窗口远在限内。
// 定位是"增强"不是"依赖"：rerank() 对调用方兜底——未配 key、API 失败、响应畸形
// 一律返回 null，调用方回落向量顺序（检索永不因 rerank 挂掉）。

import { env } from "node:process";

const API_URL = "https://open.bigmodel.cn/api/paas/v4/rerank";

const API_KEY = env.EMBEDDING_API_KEY ?? ""; // 与 embedding 同平台同 key

export const rerankEnabled = API_KEY !== "" && (env.RERANK_ENABLED ?? "1") !== "0";

interface RerankResult {
  index?: number;
  relevance_score?: number;
}

// 返回按相关性降序的 [{ index, score }]（index 回指 documents 下标）。
// 任何异常吞掉返回 null——降级路径由调用方处理。
export async function rerank(
  query: string,
  documents: string[],
  topN: number,
): Promise<Array<{ index: number; score: number }> | null> {
  if (!rerankEnabled || documents.length === 0) return null;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: "rerank", query, documents, top_n: topN }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        lastErr = `${response.status}: ${(await response.text()).slice(0, 200)}`;
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      const data = (await response.json()) as { results?: RerankResult[] };
      const results = (data.results ?? [])
        .filter(r => r.index !== undefined && r.index >= 0 && r.index < documents.length)
        .map(r => ({ index: r.index as number, score: r.relevance_score ?? 0 }))
        .sort((a, b) => b.score - a.score);
      if (results.length === 0) throw new Error("响应缺少 results 字段");
      return results;
    } catch (error) {
      clearTimeout(timer);
      lastErr = error instanceof Error ? error.message : String(error);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  // 静默降级：只打日志不打断检索（两次智谱余额耗尽的前科——降级路径是真实场景）
  console.error(`[rerank] 三次尝试均失败，回落向量顺序：${lastErr}`);
  return null;
}
