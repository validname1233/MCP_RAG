// src/index.ts —— 知识库 MCP server 最小骨架。
// 形态：无状态 Streamable HTTP（每个 POST 独立 transport，JSON 响应）+ Bearer 鉴权，
// 与 qq-bot 侧 client.ts（@modelcontextprotocol/sdk 1.x）已验证兼容的对接形态。
// 当前唯一工具 kb_issue_link：无参数，返回知识库管理页 URL（暂为占位符）。
//
// 端点路径：KB_MCP_PATH 环境变量配置（逗号分隔多个）。默认 /mcp（本地直连），
// 生产走 Higress 网关 http://zyh.kyson.asia:28080/rag ——网关不改写路径原样透传，
// 所以额外接受 /rag。

import { createServer } from "node:http";
import { env } from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(env.KB_PORT ?? 3001);
const BEARER_KEY = env.KB_BEARER_KEY ?? "";
const MCP_PATHS = new Set(
  (env.KB_MCP_PATH ?? "/mcp").split(",").map((s) => s.trim()).filter(Boolean),
);

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
  console.log(`[access] ${req.method} ${req.url} from ${req.socket.remoteAddress ?? "?"}`);
  if (req.method === "POST" && MCP_PATHS.has(req.url ?? "")) {
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
  console.log(`[kb-mcp] listening on :${PORT} (auth ${BEARER_KEY === "" ? "OFF" : "ON"}, paths ${[...MCP_PATHS].join(" ")})`);
});
