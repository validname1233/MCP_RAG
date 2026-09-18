// src/parsers/mineru.ts —— 外部解析器：MinerU 云端 API（mineru.net，OpenDataLab）。
// 用户决策的路由策略：pdf 链 [mineru, pdf-parse]（MinerU 优先，挂了本地兜底数字版）、
// docx/pptx/图片链 [minerU]（本地无能力，纯增量）。txt/md/log/xlsx 保持本地。
//
// 协议（官方 https://mineru.net/apiManage/docs）：
//   1. POST /api/v4/file-urls/batch —— 按 files[] 申请 OSS 预签名上传链接（无需公网 URL）
//   2. PUT <预签名链接> —— 文件二进制直传；⚠️ 绝不能带 Content-Type 头（403 签名不匹配）
//      上传完成即自动创建解析任务
//   3. GET /api/v4/extract-results/batch/{batch_id} —— 轮询（5s 起，指数退避，上限 15 分钟）
//   4. done → full_zip_url 下载 zip → 解压取 *_content_list.json（结构化内容列表，
//      type/text/level —— 比 full.md 更适合分块）→ 组装 sections
//
// 已配置 Token 时启用；未配置时本解析器抛 ParseError（回退链会落到 pdf-parse）。

import { unzipSync } from "node:zlib";
import { env } from "node:process";
import type { KbParser, ParsedDoc } from "./types.ts";
import { ParseError } from "./types.ts";

const BASE = "https://mineru.net/api/v4";
const TOKEN = env.MINERU_API_TOKEN ?? "";
const POLL_FIRST_MS = 5_000;
const POLL_MAX_MS = 15 * 60_000;   // 墙钟上限：排队无 SLA，15 分钟放弃走回退

export const mineruEnabled = TOKEN !== "";

// MinerU content_list.json 的条目形态（我们只消费这几个字段）
interface ContentItem {
  type: string;        // text / table / image / title / eq ...
  text?: string;       // 正文（表格为 Markdown 化文本）
  text_level?: number; // 标题层级（title 类型时 1~N）
  page_idx?: number;
  img_path?: string;   // 图片（本链路不消费，跳过）
}

interface MineruResponse<T> {
  code: number;
  msg?: string;
  data?: T;
}

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${TOKEN}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new ParseError(`MinerU HTTP ${response.status}`);
  const body = (await response.json()) as MineruResponse<T>;
  if (body.code !== 0) throw new ParseError(`MinerU 错误 ${body.code}: ${body.msg ?? ""}`.slice(0, 200));
  return body.data as T;
}

// content_list → sections：标题条目开新 section（level 进 heading），表格自成一段。
// 产出与 xlsx 解析器同构——下游 chunker 按 section 边界切块，无感知。
function contentListToSections(items: ContentItem[], filename: string): { text: string; sections: Array<{ heading?: string; text: string }> } {
  const sections: Array<{ heading?: string; text: string }> = [];
  let currentHeading = filename;
  let buf: string[] = [];

  const flush = () => {
    if (buf.length > 0) {
      sections.push({ heading: currentHeading, text: buf.join("\n\n") });
      buf = [];
    }
  };

  for (const item of items) {
    if (item.type === "title" && typeof item.text_level === "number" && item.text !== undefined) {
      flush();
      currentHeading = item.text.trim();  // 标题层级切换 = 章节边界（一级重置、多级拼接由 chunker 前缀处理）
      continue;
    }
    if (typeof item.text === "string" && item.text.trim() !== "") {
      buf.push(item.text.trim());
    }
    // image 等无 text 的类型跳过（本链路不吃 base64，方案 §7.4）
  }
  flush();

  const fullText = sections.map((s) => `## ${s.heading}\n\n${s.text}`).join("\n\n");
  return { text: fullText, sections };
}

export const mineruParser: KbParser = {
  name: "mineru",
  formats: ["pdf", "docx", "pptx", "jpg", "jpeg", "png", "webp", "bmp", "gif"],

  async parse({ filename, data }): Promise<ParsedDoc> {
    if (!mineruEnabled) {
      throw new ParseError("MinerU 未配置（.env 缺 MINERU_API_TOKEN），本格式需要云端解析");
    }
    if (data.length > 200 * 1024 * 1024) {
      throw new ParseError("文件超过 MinerU 单文件 200MB 上限");
    }

    // 1. 申请预签名上传链接
    const apply = await api<{ batch_id: string; file_urls: string[] }>("/file-urls/batch", {
      method: "POST",
      body: JSON.stringify({
        enable_table: true,
        enable_formula: false,
        language: "ch",
        files: [{ name: filename, is_ocr: true, data_id: `mcp-rag-${Date.now()}` }],
      }),
    });
    const uploadUrl = apply.file_urls[0];
    if (uploadUrl === undefined) throw new ParseError("MinerU 未返回上传链接");

    // 2. PUT 直传（不带 Content-Type——带了 OSS 预签名校验 403，社区 issue 实锤的坑）
    const put = await fetch(uploadUrl, {
      method: "PUT",
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(120_000),
    });
    if (!put.ok) throw new ParseError(`文件上传失败 HTTP ${put.status}（若 403 请检查是否误带请求头）`);

    // 3. 轮询批量结果（上传完成即自动开任务）
    const started = Date.now();
    let delay = POLL_FIRST_MS;
    let zipUrl = "";
    for (;;) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
      const status = await api<{ extract_result?: Array<{ state: string; full_zip_url?: string; err_msg?: string }> }>(
        `/extract-results/batch/${apply.batch_id}`, { method: "GET" });
      const result = status.extract_result?.[0];
      if (result === undefined) throw new ParseError("MinerU 查询结果为空");
      if (result.state === "done") {
        zipUrl = result.full_zip_url ?? "";
        break;
      }
      if (result.state === "failed") {
        throw new ParseError(`MinerU 解析失败：${(result.err_msg ?? "").slice(0, 150)}`);
      }
      if (Date.now() - started > POLL_MAX_MS) {
        throw new ParseError("MinerU 解析超时（15 分钟）——已放弃，回退本地解析");
      }
      // pending / running / converting → 继续轮询
    }
    if (zipUrl === "") throw new ParseError("MinerU 完成但未给出结果包地址");

    // 4. 下载 zip → 解压取 content_list（结果链接过期时间不明，当场消费不落盘）
    const zipResp = await fetch(zipUrl, { signal: AbortSignal.timeout(120_000) });
    if (!zipResp.ok) throw new ParseError(`结果包下载失败 HTTP ${zipResp.status}`);
    const zipBuf = Buffer.from(await zipResp.arrayBuffer());
    let files: Record<string, Buffer>;
    try {
      files = unzipSync(zipBuf) as Record<string, Buffer>;
    } catch {
      throw new ParseError("结果包解压失败（zip 结构异常）");
    }

    const listName = Object.keys(files).find((n) => n.endsWith("content_list.json"));
    if (listName === undefined) throw new ParseError("结果包里没有 content_list.json");
    let items: ContentItem[];
    try {
      items = JSON.parse(files[listName].toString("utf8")) as ContentItem[];
    } catch {
      throw new ParseError("content_list.json 解析失败");
    }

    const { text, sections } = contentListToSections(items, filename);
    if (text.trim() === "") throw new ParseError("MinerU 未解析出任何文本内容");
    return { text, sections };
  },
};
