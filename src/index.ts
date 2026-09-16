// src/index.ts —— 组装根：配置 + HTTP server + 路由分发（MCP / Web / 404）。
//
// 路径约定：Higress 网关把 http://zyh.kyson.asia:28080/rag 原样透传到本服务，
// 所以每个路由都同时接受裸路径（本地直连）和 /rag 前缀（经网关）。

import { createServer } from "node:http";
import { env } from "node:process";
import { buildMcpServer, handleMcpRequest } from "./mcp.ts";
import { buildWebHandler } from "./web.ts";
import { pageHtml } from "./page.ts";
import { startWorker } from "./worker.ts";
import { embeddingEnabled } from "./embed.ts";
import "./db.ts";

const PORT = Number(env.KB_PORT ?? 3001);
const BEARER_KEY = env.KB_BEARER_KEY ?? "";
const PUBLIC_URL = (env.KB_PUBLIC_URL ?? "http://zyh.kyson.asia:28080/rag").replace(/\/+$/, "");
const MCP_PATHS = new Set(
  (env.KB_MCP_PATH ?? "/mcp").split(",").map((s) => s.trim()).filter(Boolean),
);

const mcp = buildMcpServer(PUBLIC_URL);
const web = buildWebHandler(pageHtml);

const httpServer = createServer(async (req, res) => {
  console.log(`[access] ${req.method} ${req.url} from ${req.socket.remoteAddress ?? "?"}`);

  try {
    // 1. MCP 端点：主 Bearer key 鉴权（bot 专用）
    if (req.method === "POST" && MCP_PATHS.has(req.url ?? "")) {
      if (BEARER_KEY === "" || req.headers.authorization !== `Bearer ${BEARER_KEY}`) {
        res.writeHead(401).end();
        return;
      }
      await handleMcpRequest(mcp, req, res);
      return;
    }

    // 2. Web 管理面（页面 + REST API，管理 token 鉴权）
    if (await web(req, res)) return;

    res.writeHead(404).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[error] ${req.method} ${req.url}: ${message}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("服务器内部错误");
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`[kb-mcp] listening on :${PORT} (auth ${BEARER_KEY === "" ? "OFF" : "ON"}, paths ${[...MCP_PATHS].join(" ")}, public ${PUBLIC_URL})`);
  console.log(`[kb-mcp] embedding ${embeddingEnabled ? "ON（智谱 API）" : "OFF（假向量联调模式——配 EMBEDDING_API_KEY 启用）"}`);
  startWorker();
});
