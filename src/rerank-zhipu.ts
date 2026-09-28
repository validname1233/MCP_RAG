// src/rerank-zhipu.ts —— 智谱 BigModel 文本重排序 provider。
// 与 embedding 同平台同 key（EMBEDDING_API_KEY）；模型固定 "rerank"（平台唯一）。
// ⚠ 实测（2026-09-28 A/B）：中文 500~900 字块对上打分饱和（top-20 中 15 个并列
// 1.000000，区分度 ~2e-7），重排退化为乱序，snippet 68.3%→50%。保留实现供对照，
// 生产建议 provider 切 ali（qwen3-rerank）。

import { env } from "node:process";
import { config } from "./config.ts";
import type { RerankProvider, RerankResult } from "./rerank.ts";

const API_URL = "https://open.bigmodel.cn/api/paas/v4/rerank";
const API_KEY = () => env.EMBEDDING_API_KEY ?? "";

export const zhipuRerankProvider: RerankProvider = {
  name: "zhipu",
  enabled: () => API_KEY() !== "",
  async rerank(query, documents, topN): Promise<RerankResult[] | null> {
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY()}` },
          body: JSON.stringify({
            model: config.rerank.model ?? "rerank",
            query, documents, top_n: topN,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          lastErr = `${response.status}: ${(await response.text()).slice(0, 200)}`;
          await new Promise(r => setTimeout(r, attempt * 2000));
          continue;
        }
        const data = (await response.json()) as { results?: Array<{ index?: number; relevance_score?: number }> };
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
    console.error(`[rerank:zhipu] 三次尝试均失败，回落向量顺序：${lastErr}`);
    return null;
  },
};
