// src/web.ts —— Web 管理面：页面 + 四个 REST API，全部以管理 token 为凭据。
//
// 鉴权模型（方案文档 §6.1）：token 即凭据——链接发在群里人人可见，知道 token =
// 拥有该库全部权限（上传/删除/下载），家用场景的安全模型。
// API 用 Authorization: Bearer <token> 头（前端从 localStorage 取）；
// 下载例外地用 /g/<token>/files/<id> 路径形式——浏览器 <a> 下载带不了自定义头。

import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scopeByToken, entriesByScope, insertEntry, entryById, deleteEntry, entryDir } from "./db.ts";

// 单文件上限（字节）。家用文档场景 200MB 足够，防误传超大文件占满盘。
const MAX_SIZE = 200 * 1024 * 1024;

// 读完整请求体（上传用；上限校验在流式累计里做，超限立刻断）
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > limit) {
        reject(new Error("文件过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// 极简 multipart/form-data 解析：只取第一个 file part 和 filename。
// 不引 formidable/multer——我们的表单就一个文件控件，边界切割够用且零依赖。
function parseMultipart(body: Buffer, boundary: string): { filename: string; data: Buffer } | null {
  const delim = Buffer.from(`--${boundary}`);
  const parts: Array<{ start: number; end: number }> = [];
  let idx = body.indexOf(delim);
  while (idx !== -1) {
    const next = body.indexOf(delim, idx + delim.length);
    if (next === -1) break;
    parts.push({ start: idx + delim.length, end: next });
    idx = next;
  }
  for (const p of parts) {
    let seg = body.subarray(p.start, p.end);
    if (seg[0] === 0x0d && seg[1] === 0x0a) seg = seg.subarray(2); // 去掉 CRLF
    const headerEnd = seg.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = seg.subarray(0, headerEnd).toString("utf8");
    const m = /filename="([^"]*)"/.exec(headers);
    if (m === null) continue; // 跳过非文件 part（如按钮提交值）
    let data = seg.subarray(headerEnd + 4);
    if (data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) data = data.subarray(0, data.length - 2);
    return { filename: m[1], data };
  }
  return null;
}

function json(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

export function buildWebHandler(pageHtml: (token: string) => string) {
  return async function web(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? "";
    const method = req.method ?? "";

    // ---- 页面与下载：token 在路径里 ----
    // /g/<token>（本地直连）| /rag/g/<token>（网关透传前缀）
    const pageMatch = url.match(/^\/(?:rag\/)?g\/([A-Za-z0-9_-]{16,})$/);
    if (method === "GET" && pageMatch !== null) {
      const scope = (scopeByToken.get(pageMatch[1]) as { scope: string } | undefined)?.scope;
      if (scope === undefined) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("链接无效或已重置。请在 QQ 里重新发送 /知识库管理 获取新链接。");
        return true;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pageHtml(pageMatch[1]));
      return true;
    }

    // /g/<token>/files/<id>：浏览器下载（<a> 标签带不了 header，token 只能进路径）
    const dlMatch = url.match(/^\/(?:rag\/)?g\/([A-Za-z0-9_-]{16,})\/files\/(\d+)$/);
    if (method === "GET" && dlMatch !== null) {
      const token = dlMatch[1];
      const scope = (scopeByToken.get(token) as { scope: string } | undefined)?.scope;
      if (scope === undefined) {
        res.writeHead(404).end();
        return true;
      }
      const entry = entryById.get(Number(dlMatch[2]), scope) as
        | { id: number; stored_path: string; filename: string; mime: string | null }
        | undefined;
      if (entry === undefined || !existsSync(entry.stored_path)) {
        res.writeHead(404).end();
        return true;
      }
      // RFC 5987：中文文件名用 filename* 编码，老客户端回退 ASCII 名
      const ascii = entry.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
      res.writeHead(200, {
        "Content-Type": entry.mime ?? "application/octet-stream",
        "Content-Length": statSync(entry.stored_path).size,
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
      });
      createReadStream(entry.stored_path).pipe(res);
      return true;
    }

    // ---- REST API：token 在 Authorization 头 ----
    if (url.match(/^\/(?:rag\/)?g\/[A-Za-z0-9_-]{16,}\/api\//) !== null || url.match(/^\/api\//) !== null) {
      // 从头或路径取 token（前端两种都发；路径形式是 /g/<token>/api/...）
      let token = "";
      const pathToken = url.match(/^\/(?:rag\/)?g\/([A-Za-z0-9_-]{16,})\/api\//)?.[1];
      if (pathToken !== undefined) token = pathToken;
      const auth = req.headers.authorization;
      if (token === "" && auth?.startsWith("Bearer ")) token = auth.slice(7);
      const scope = token !== "" ? (scopeByToken.get(token) as { scope: string } | undefined)?.scope : undefined;
      if (scope === undefined) {
        json(res, 401, { error: "未授权：请从管理页链接进入" });
        return true;
      }

      // 上传：POST /g/<token>/api/entries（multipart）
      if (method === "POST" && url.endsWith("/api/entries")) {
        const ctype = req.headers["content-type"] ?? "";
        const bm = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ctype);
        if (bm === null) {
          json(res, 400, { error: "请求必须是 multipart/form-data" });
          return true;
        }
        const boundary = bm[1] ?? bm[2];
        let body: Buffer;
        try {
          body = await readBody(req, MAX_SIZE);
        } catch (e) {
          json(res, 413, { error: "文件过大（上限 200MB）" });
          return true;
        }
        const part = parseMultipart(body, boundary);
        if (part === null || part.filename === "" || part.data.length === 0) {
          json(res, 400, { error: "没有收到文件" });
          return true;
        }
        const info = insertEntry.run(
          scope, part.filename, "", part.data.length, req.headers["content-type"]?.split(";")[0] ?? null,
        );
        const id = Number(info.lastInsertRowid);
        const dir = entryDir(scope, id);
        const stored = join(dir, basename(part.filename) || `file-${id}`);
        await mkdir(dir, { recursive: true });
        await writeFile(stored, part.data);
        dbUpdatePath(id, scope, stored);
        json(res, 200, { id, filename: part.filename, size: part.data.length });
        return true;
      }

      // 列表：GET /g/<token>/api/entries
      if (method === "GET" && url.endsWith("/api/entries")) {
        const rows = entriesByScope.all(scope);
        json(res, 200, { entries: rows });
        return true;
      }

      // 删除：DELETE /g/<token>/api/entries/<id>
      const delMatch = url.match(/\/api\/entries\/(\d+)$/);
      if (method === "DELETE" && delMatch !== null) {
        const id = Number(delMatch[1]);
        const entry = entryById.get(id, scope) as { stored_path: string } | undefined;
        if (entry === undefined) {
          json(res, 404, { error: "条目不存在" });
          return true;
        }
        deleteEntry.run(id, scope);
        await rm(entryDir(scope, id), { recursive: true, force: true });
        json(res, 200, { ok: true });
        return true;
      }

      json(res, 404, { error: "未知 API" });
      return true;
    }

    return false; // 不归 web 管，交给调用方 404
  };
}

// stored_path 写入（建行时还不知道路径，落盘后回填）
import { db } from "./db.ts";
function dbUpdatePath(id: number, scope: string, path: string): void {
  db.prepare("UPDATE entries SET stored_path = ? WHERE id = ? AND scope = ?").run(path, id, scope);
}
