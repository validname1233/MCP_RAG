// src/mcp.ts —— MCP 工具面：kb_issue_link 签发（bot 专用，主 Bearer key 鉴权）。
// 从 index.ts 平移而来；transport 仍是无状态 Streamable HTTP（每请求独立实例）。

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { insertToken, tokenByScope } from "./db.ts";

export function buildMcpServer(publicUrl: string): McpServer {
  const mcp = new McpServer({ name: "kb", version: "0.1.0" });

  mcp.tool(
    "kb_issue_link",
    "签发某个会话的知识库管理页链接。scope 由调用方按会话计算（kb:group:<群openid> " +
    "或 kb:c2c:<用户openid>），同一 scope 重复调用返回同一链接。",
    { scope: z.string().describe("会话隔离键，如 kb:group:abc123") },
    async ({ scope }) => {
      if (!/^kb:(group|c2c):[A-Za-z0-9_-]+$/.test(scope)) {
        return {
          content: [{ type: "text", text: `scope 格式不合法（收到 "${scope}"），应为 kb:group:<openid> 或 kb:c2c:<openid>` }],
          isError: true,
        };
      }
      const existing = tokenByScope.get(scope) as { token: string } | undefined;
      const token = existing?.token ?? randomBytes(24).toString("base64url");
      if (existing === undefined) insertToken.run(scope, token);
      return { content: [{ type: "text", text: `${publicUrl}/g/${token}` }] };
    },
  );

  return mcp;
}

// 无状态 Streamable HTTP：每个 POST 一个独立 transport，单次 JSON 往返。
export async function handleMcpRequest(mcp: McpServer, req: any, res: any): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}
