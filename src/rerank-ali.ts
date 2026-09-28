// src/rerank-ali.ts —— 阿里云百炼（DashScope）文本重排序 provider。
// 模型矩阵（docs：help.aliyun.com/zh/model-studio/text-rerank-api）：
//   qwen3-rerank（默认）：≤500 候选 / 单条 4,000 字符 / 100+ 语言，兼容式端点
//   qwen3.7-text-rerank：≤500 / 30,000 / 201 语言，原生端点
//   qwen3-vl-rerank：多模态（图片/视频候选），原生端点
//   gte-rerank-v2：旧 gte-rerank 2026-05-30 下线，勿用
// 端点二选一（由模型名自动路由）：
//   qwen3-rerank → OpenAI 兼容式：{workspace}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks
//     （query/documents/top_n 平铺，results 在顶层——与智谱同形，迁移成本最低）
//   其它 → 原生式：…/api/v1/services/rerank/text-rerank/text-rerank
//     （input:{query,documents} + parameters:{top_n} 嵌套，results 在 output.results）
// 认证：百炼 API Key（DASHSCOPE_API_KEY）；⚠ relevance_score 是请求内相对分，
// 不可跨请求比较（不能当绝对阈值用）。

import { env } from "node:process";
import { config } from "./config.ts";
import type { RerankProvider, RerankResult } from "./rerank.ts";

const API_KEY = () => env.DASHSCOPE_API_KEY ?? "";
// WorkspaceId 在业务空间维度的域名里（compat 与原生端点同前缀），控制台查看
const workspace = () => (env.DASHSCOPE_WORKSPACE_ID ?? "").trim();
const base = () => `https://${workspace()}.cn-beijing.maas.aliyuncs.com`;
const COMPAT_MODEL = "qwen3-rerank"; // 兼容式端点目前仅此模型

interface RawResult { index?: number; relevance_score?: number }

export const aliRerankProvider: RerankProvider = {
  name: "ali",
  enabled: () => API_KEY() !== "" && workspace() !== "",
  async rerank(query, documents, topN): Promise<RerankResult[] | null> {
    const model = config.rerank.model ?? COMPAT_MODEL;
    const useCompat = model === COMPAT_MODEL;
    const url = useCompat
      ? `${base()}/compatible-api/v1/reranks`
      : `${base()}/api/v1/services/rerank/text-rerank/text-rerank`;
    // 兼容式：平铺（智谱同形）；原生式：input/parameters 嵌套
    const body = useCompat
      ? { model, query, documents, top_n: topN }
      : { model, input: { query, documents }, parameters: { top_n: topN } };

    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY()}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          lastErr = `${response.status}: ${(await response.text()).slice(0, 200)}`;
          await new Promise(r => setTimeout(r, attempt * 2000));
          continue;
        }
        const data = (await response.json()) as { results?: RawResult[]; output?: { results?: RawResult[] } };
        const raw = data.results ?? data.output?.results ?? [];
        const results = raw
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
    console.error(`[rerank:ali] 三次尝试均失败，回落向量顺序：${lastErr}`);
    return null;
  },
};
