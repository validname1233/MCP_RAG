// src/rerank.ts —— rerank provider 注册表 + 调度入口（两阶段检索第二段）。
// 模式照 parsers/registry.ts：provider 代码内注册（Map），config.json 的
// rerank.provider 按名选用——换模型 = 改配置文件，零代码改动。
// 定位仍是"增强不是依赖"：未配置/无 key/API 失败一律返回 null，调用方回落
// 向量顺序（检索永不因 rerank 挂掉）。
// 背景：智谱 rerank 在中文长块对上打分饱和（15/20 并列 1.0）为负优化，
// provider 化即为此而生——A/B 框架与降级逻辑复用，模型可插拔。

import { env } from "node:process";
import { config } from "./config.ts";
import { zhipuRerankProvider } from "./rerank-zhipu.ts";
import { aliRerankProvider } from "./rerank-ali.ts";

export interface RerankResult {
  index: number; // 回指调用方 documents 数组下标
  score: number; // relevance，越大越相关（请求内相对分，不可跨请求比较）
}

export interface RerankProvider {
  name: string;
  enabled(): boolean; // key 等前置条件是否就绪
  rerank(query: string, documents: string[], topN: number): Promise<RerankResult[] | null>;
}

const providers = new Map<string, RerankProvider>();
export function registerRerankProvider(p: RerankProvider): void {
  providers.set(p.name, p);
}

registerRerankProvider(zhipuRerankProvider);
registerRerankProvider(aliRerankProvider);

export function getRerankProvider(): RerankProvider | null {
  const name = config.rerank.provider;
  if (name === "none") return null;
  return providers.get(name) ?? null;
}

const active = getRerankProvider();
// 总开关：RERANK_ENABLED=0 强制关（eval 的 vector 基线通道用；生产杀开关也用它）
export const rerankEnabled = active !== null && active.enabled() && env.RERANK_ENABLED !== "0";

export function rerankDisabledReason(): string {
  if (config.rerank.provider === "none") return "config.json 的 rerank.provider 为 none";
  if (active === null) return `配置的 provider「${config.rerank.provider}」不存在（已注册：${[...providers.keys()].join("、")}）`;
  if (env.RERANK_ENABLED === "0") return "RERANK_ENABLED=0 强制关闭";
  if (!active.enabled()) return `provider「${active.name}」的 key 未配置（查 .env）`;
  return "";
}

// 调度入口：任何 provider 异常吞掉返回 null——降级路径由调用方处理
export async function rerank(
  query: string,
  documents: string[],
  topN: number,
): Promise<RerankResult[] | null> {
  if (!rerankEnabled || active === null || documents.length === 0) return null;
  try {
    return await active.rerank(query, documents, topN);
  } catch (error) {
    console.error(`[rerank] provider ${active.name} 异常，回落向量顺序：${error instanceof Error ? error.message : error}`);
    return null;
  }
}
