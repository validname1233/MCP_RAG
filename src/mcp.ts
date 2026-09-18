// src/mcp.ts —— MCP 工具面：kb_issue_link 签发（bot 代码直调）+ kb_search 检索
// （暴露给模型，scope 由 bot 适配器强制注入——模型不可信传参）。
// transport 仍是无状态 Streamable HTTP（每请求独立实例）。

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { insertToken, tokenByScope } from "./db.ts";
import { kbSearch, formatHitsForModel } from "./search.ts";

const SCOPE_DESC = "会话隔离键，如 kb:group:abc123（由调用方按会话计算，不是用户输入）";

export function buildMcpServer(publicUrl: string): McpServer {
  const mcp = new McpServer({ name: "kb", version: "0.1.0" });

  mcp.tool(
    "kb_issue_link",
    "签发某个会话的知识库管理页链接。scope 由调用方按会话计算（kb:group:<群openid> " +
    "或 kb:c2c:<用户openid>），同一 scope 重复调用返回同一链接。",
    { scope: z.string().describe(SCOPE_DESC) },
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

  mcp.tool(
    "kb_search",
    "在当前会话的知识库中做语义检索（RAG 召回）。输入自然语言查询，返回最相关的" +
    "文档片段（含来源文档名与章节）。用户问到知识库里可能有的内容时调用；" +
    "知识库为空或未命中时会明确说明。",
    {
      query: z.string().min(1).describe("自然语言查询，如'张三的工资是多少'"),
      top_k: z.number().int().min(1).max(20).optional().describe("返回条数，默认 5"),
      scope: z.string().describe(SCOPE_DESC),
    },
    async ({ query, top_k, scope }) => {
      try {
        const hits = await kbSearch(scope, query, top_k ?? 5);
        return { content: [{ type: "text", text: formatHitsForModel(hits) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 可行动错误：模型能据此放弃检索或提示用户（isError 约定，方案 §7.4）
        return { content: [{ type: "text", text: `知识库检索失败：${message.slice(0, 200)}` }], isError: true };
      }
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
