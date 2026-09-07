// src/index.ts —— 知识库 MCP server 最小骨架。
// 形态：无状态 Streamable HTTP（每个 POST 独立 transport，JSON 响应）+ Bearer 鉴权，
// 与 qq-bot 侧 client.ts（@modelcontextprotocol/sdk 1.x）已验证兼容的对接形态。
// 当前唯一工具 kb_issue_link：无参数，返回知识库管理页 URL（暂为占位符）。

import { createServer } from "node:http";
import { env } from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(env.KB_PORT ?? 3001);
const BEARER_KEY = env.KB_BEARER_KEY ?? "";

const mcp = new McpServer({ name: "kb", version: "0.1.0" });

mcp.tool(
  "kb_issue_link",
  "签发当前会话的知识库管理页链接。无参数，返回一个 URL，" +
  "在浏览器打开即可上传/浏览/下载该会话的知识库文件。同一会话重复调用返回同一链接。",
  {},
  async () => ({
    content: [{ type: "text", text: "https://kb.example.com/g/placeholder-token" }],
  }),
);

const httpServer = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/mcp") {
    // 公网暴露必须鉴权：key 不带或不匹配一律 401（与 qq-bot mcp.json 的 apiKey 对应）
    if (BEARER_KEY === "" || req.headers.authorization !== `Bearer ${BEARER_KEY}`) {
      res.writeHead(401).end();
      return;
    }
    // 无状态模式：每个请求独立 transport，单次 JSON 往返
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }
  res.writeHead(404).end();
});

httpServer.listen(PORT, () => {
  console.log(`[kb-mcp] listening on :${PORT}/mcp (auth ${BEARER_KEY === "" ? "OFF" : "ON"})`);
});
