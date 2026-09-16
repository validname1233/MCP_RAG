// src/index.ts —— 知识库端侧 server：MCP 工具面 + Web 管理页（占位）。
//
// 两种入口共一个进程：
//   MCP（POST /mcp 或 /rag）：bot 侧专用。kb_issue_link 签发管理页链接（真实实现：
//     scope → token 幂等映射，存 SQLite）；鉴权走主 Bearer key。
//   Web 页（GET /g/<token>）：人用。token 即凭据（链接发在群里人人可见，知道
//     token = 拥有该库全部权限——家用场景的安全模型，见方案文档 §6.1/§10）。
//
// 路径说明：Higress 网关把 http://zyh.kyson.asia:28080/rag 原样透传到本服务，
// 所以 MCP 端点同时接受 /mcp（本地直连）和 /rag（经网关）；管理页同理接受
// /g/<token> 和 /rag/g/<token>。对外拼链接一律用 KB_PUBLIC_URL（网关地址）。

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(env.KB_PORT ?? 3001);
const BEARER_KEY = env.KB_BEARER_KEY ?? "";
// 对外基础 URL（网关地址）：签发的链接用它拼，不能用监听地址（那是内网视角）
const PUBLIC_URL = (env.KB_PUBLIC_URL ?? "http://zyh.kyson.asia:28080/rag").replace(/\/+$/, "");
const MCP_PATHS = new Set(
  (env.KB_MCP_PATH ?? "/mcp").split(",").map((s) => s.trim()).filter(Boolean),
);

// ---------- 存储：tokens 表（scope → token 幂等映射） ----------
// 同一 scope 重复签发返回同一 token——链接长期稳定可收藏，忘了随时再领。
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, "kb.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    scope      TEXT PRIMARY KEY,
    token      TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertToken = db.prepare(
  "INSERT INTO tokens (scope, token) VALUES (?, ?) ON CONFLICT(scope) DO NOTHING",
);
const tokenByScope = db.prepare("SELECT token FROM tokens WHERE scope = ?");
const scopeByToken = db.prepare("SELECT scope FROM tokens WHERE token = ?");

// 合法 scope 形如 kb:group:<openid> / kb:c2c:<openid>（bot 侧 kbScope() 算出）。
// 拒绝其它格式：MCP 调用方只可能是 bot，错了就该早点报清楚。
function isValidScope(scope: string): boolean {
  return /^kb:(group|c2c):[A-Za-z0-9_-]+$/.test(scope);
}

function issueLink(scope: string): string {
  const existing = tokenByScope.get(scope) as { token: string } | undefined;
  const token = existing?.token ?? randomBytes(24).toString("base64url");
  if (existing === undefined) insertToken.run(scope, token);
  return `${PUBLIC_URL}/g/${token}`;
}

// ---------- MCP 工具面 ----------
const mcp = new McpServer({ name: "kb", version: "0.1.0" });

mcp.tool(
  "kb_issue_link",
  "签发某个会话的知识库管理页链接。scope 由调用方按会话计算（kb:group:<群openid> " +
  "或 kb:c2c:<用户openid>），同一 scope 重复调用返回同一链接。",
  { scope: z.string().describe("会话隔离键，如 kb:group:abc123") },
  async ({ scope }) => {
    if (!isValidScope(scope)) {
      // 可行动的错误说明：模型/调用方能据此修正（isError 文案约定，方案文档 §7.4）
      return {
        content: [{ type: "text", text: `scope 格式不合法（收到 "${scope}"），应为 kb:group:<openid> 或 kb:c2c:<openid>` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: issueLink(scope) }] };
  },
);

// ---------- Web 管理页（占位前端） ----------
// 空壳：只做 token 校验和身份记忆（localStorage），功能回头再填。
function pageHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>知识库管理</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f6f7f9; margin: 0; }
  .card { max-width: 640px; margin: 12vh auto 0; background: #fff; border-radius: 12px;
          padding: 40px; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { color: #666; font-size: 14px; line-height: 1.8; margin: 0; }
</style>
</head>
<body>
<div class="card">
  <h1>📚 知识库管理</h1>
  <p>页面建设中，敬请期待。</p>
  <p>你的访问凭证已保存在本设备，下次打开无需重新输入。</p>
</div>
<script>
  // token 即凭据：存 localStorage，将来所有 API 调用带上它（当前为占位）
  try { localStorage.setItem("kb_token", ${JSON.stringify(token)}); } catch (e) {}
</script>
</body>
</html>`;
}

// ---------- HTTP 路由 ----------
const httpServer = createServer(async (req, res) => {
  console.log(`[access] ${req.method} ${req.url} from ${req.socket.remoteAddress ?? "?"}`);

  // MCP 端点：主 Bearer key 鉴权（bot 专用）
  if (req.method === "POST" && MCP_PATHS.has(req.url ?? "")) {
    if (BEARER_KEY === "" || req.headers.authorization !== `Bearer ${BEARER_KEY}`) {
      res.writeHead(401).end();
      return;
    }
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // 管理页：GET /g/<token>（本地直连）或 /rag/g/<token>（经网关，前缀透传）
  const pageMatch = (req.url ?? "").match(/^\/(?:rag\/)?g\/([A-Za-z0-9_-]{16,})$/);
  if (req.method === "GET" && pageMatch !== null) {
    const scope = scopeByToken.get(pageMatch[1]) as { scope: string } | undefined;
    if (scope === undefined) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("链接无效或已重置。请在 QQ 里重新发送 /知识库管理 获取新链接。");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pageHtml(pageMatch[1]));
    return;
  }

  res.writeHead(404).end();
});

httpServer.listen(PORT, () => {
  console.log(`[kb-mcp] listening on :${PORT} (auth ${BEARER_KEY === "" ? "OFF" : "ON"}, paths ${[...MCP_PATHS].join(" ")}, public ${PUBLIC_URL})`);
});
