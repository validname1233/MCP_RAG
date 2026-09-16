// src/embed.ts —— 智谱 BigModel embedding 客户端（知识库入库批量场景）。
// 接口与 qq-bot 侧 services/embedding.ts 完全同款（open.bigmodel.cn v4），
// 差异只在批量：input 传 string[]，响应 data 数组按序对应。
// 限速友好：分批 + 失败退避重试（worker 是串行队列，压力天然可控）。

import { env } from "node:process";

const API_URL = "https://open.bigmodel.cn/api/paas/v4/embeddings";
const DIMENSIONS = 1024; // 与 bot 侧一致（LanceDB 建表维度也按它）

// .env 未配 key 时启用假向量模式（流水线联调用）：确定性伪随机，只保证形状对
const API_KEY = env.EMBEDDING_API_KEY ?? "";

export const embeddingEnabled = API_KEY !== "";

export interface EmbedBatchResult {
  vectors: number[][];
  fake: boolean;
}

function fakeVector(seed: number): number[] {
  // xorshift 确定性伪随机——同一 seed 同一向量，测试可复现
  let x = seed || 1;
  const v = new Array<number>(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    v[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
  }
  return v;
}

async function callApi(inputs: string[]): Promise<number[][]> {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: env.EMBEDDING_MODEL ?? "embedding-3", input: inputs, dimensions: DIMENSIONS }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        lastErr = `${response.status}: ${(await response.text()).slice(0, 200)}`;
        // 429 限速 / 5xx 抖动：退避重试；4xx 参数错重试无意义，但统一再试一次成本低
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
      const vectors = inputs.map((_, i) => data.data?.[i]?.embedding);
      if (vectors.some(v => v === undefined)) throw new Error("响应缺少 embedding 字段");
      return vectors as number[][];
    } catch (error) {
      clearTimeout(timer);
      lastErr = error instanceof Error ? error.message : String(error);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error(`embedding API 三次尝试均失败：${lastErr}`);
}

// 批量入口：内部按 16 条/批分片（智谱单请求 input 上限 64，留余量），
// 逐批串行——worker 本身就是串行的，不额外并发。
export async function embedBatch(texts: string[], seedBase = 0): Promise<EmbedBatchResult> {
  if (!embeddingEnabled) {
    return { vectors: texts.map((_, i) => fakeVector(seedBase + i)), fake: true };
  }
  const vectors: number[][] = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const part = await callApi(texts.slice(i, i + BATCH));
    vectors.push(...part);
  }
  return { vectors, fake: false };
}
