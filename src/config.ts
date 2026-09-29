// src/config.ts —— 行为配置层：config.json（仓库根，可选）+ 环境变量覆盖。
// 优先级：内置默认 < config.json < 环境变量（脚本/实验用 env 临时改，文件改长期值，
// 与 qq-bot 侧 mcp.json 的分工同款思想：文件管行为，.env 管密钥）。
// config.json 不入 git（.gitignore），模板见 config.json.example。

import { env } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RerankProviderName {
  provider: "none" | "zhipu" | "ali";
  model?: string;      // 留空 = 各 provider 默认模型
  candidates: number;  // 两阶段检索的召回候选窗口
}

export interface AppConfig {
  rerank: RerankProviderName;
  search: {
    channel: "vector" | "fts" | "hybrid";  // 检索通道：纯向量 | 纯关键词 | 融合（hybrid 待实现）
    maxTopK: number;  // kbSearch 的 topK 硬上限（防误传大 K）
  };
}

// config.json 形状（宽松解析：缺字段用默认，多余字段忽略——升级不炸旧配置）
interface ConfigFile {
  rerank?: { provider?: string; model?: string; candidates?: number };
  search?: { channel?: string; maxTopK?: number };
}

const ROOT = join(import.meta.dirname, "..");
let file: ConfigFile = {};
const configPath = join(ROOT, "config.json");
if (existsSync(configPath)) {
  try {
    file = JSON.parse(readFileSync(configPath, "utf8")) as ConfigFile;
  } catch (error) {
    console.error(`[config] config.json 解析失败，用默认配置：${error instanceof Error ? error.message : error}`);
  }
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) && n > 0 ? n : d;
};

const provider = (env.RERANK_PROVIDER ?? file.rerank?.provider ?? "none") as AppConfig["rerank"]["provider"];
const channel = (env.KB_CHANNEL ?? file.search?.channel ?? "vector") as AppConfig["search"]["channel"];

export const config: AppConfig = {
  rerank: {
    provider: ["none", "zhipu", "ali"].includes(provider) ? provider : "none",
    model: env.RERANK_MODEL ?? file.rerank?.model ?? undefined,
    candidates: num(env.KB_RERANK_CANDIDATES, file.rerank?.candidates ?? 20),
  },
  search: {
    channel: ["vector", "fts", "hybrid"].includes(channel) ? channel : "vector",
    maxTopK: num(env.KB_MAX_TOPK, file.search?.maxTopK ?? 20),
  },
};
