// src/chunker.ts —— 切块器：解析出的全文 → 检索用的 chunk 数组（方案 §6.3）。
//
// 策略：按 500~800 字（中文 1 字≈1 token 的近似）切块，块间带 1 行重叠防语义
// 被硬切断；每块加"文档名 + 章节"前缀——召回时模型看到的是自含语义的片段。
// Markdown 的标题行（# 开头）被当作天然块边界优先切分，标题进前缀。

export interface Chunk {
  index: number;      // 文档内序号（0 起）
  heading: string;    // 所属章节标题（无结构时为空串）
  prefix: string;     // 给 embedding 的前缀文本（文档名 + 标题）
  text: string;       // chunk 原文（不含前缀；存库分开，召回时拼装）
}

const MIN = 500;      // 目标块下限（字）
const MAX = 900;      // 硬上限（含前缀折算），超了在句边界二分
const OVERLAP = 80;   // 相邻块重叠（字）

// 段落切分：空行是天然边界；没有空行的长文（小说式 txt）退到换行
function splitParagraphs(text: string): string[] {
  const byBlank = text.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  return text.split(/\n+/).map(s => s.trim()).filter(Boolean);
}

// 超长段落在句边界切（。！？；.!?; 后跟空白或结尾），找不到句边界就硬切
function splitLongParagraph(p: string, limit: number): string[] {
  if (p.length <= limit) return [p];
  const out: string[] = [];
  let rest = p;
  while (rest.length > limit) {
    let cut = -1;
    for (const sep of ["。", "！", "？", "；", ". ", "! ", "? ", "; "]) {
      const i = rest.lastIndexOf(sep, limit);
      if (i > limit * 0.4) { cut = i + sep.length; break; }
    }
    if (cut === -1) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(Math.max(cut - OVERLAP, 0));
  }
  if (rest.trim() !== "") out.push(rest.trim());
  return out;
}

export function chunkDocument(filename: string, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = "";
  let buf: string[] = [];
  let bufLen = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const body = buf.join("\n");
    if (body.trim() !== "") {
      chunks.push({
        index: chunks.length,
        heading,
        prefix: heading !== "" ? `${filename} · ${heading}` : filename,
        text: body,
      });
    }
    // 重叠：保留尾部段落给下一块
    const tail = buf[buf.length - 1] ?? "";
    buf = tail.length <= OVERLAP ? [tail] : [tail.slice(-OVERLAP)];
    bufLen = buf.join("\n").length;
  };

  for (const raw of splitParagraphs(text)) {
    // Markdown 标题行：章节切换，先冲刷当前块（标题是更强的边界）
    const h = /^(#{1,6})\s+(.+)$/.exec(raw);
    if (h !== null && raw.length < 100) {
      flush();
      heading = h[2].trim();
      continue;
    }
    for (const p of splitLongParagraph(raw, MAX)) {
      if (bufLen + p.length + 1 > MAX && bufLen >= MIN) {
        flush();
      }
      buf.push(p);
      bufLen += p.length + 1;
    }
  }
  // 收尾：剩余不足 MIN 的尾巴并入（或独立成块——已在 buf 里，直接冲）
  buf = buf.filter(b => b !== "");
  if (buf.length > 0) {
    const body = buf.join("\n");
    // 尾块太短且前面有块：并进最后一块省一次 embedding
    const last = chunks[chunks.length - 1];
    if (last !== undefined && body.length < MIN / 2 && last.text.length + body.length <= MAX) {
      last.text += "\n" + body;
    } else if (body.trim() !== "") {
      chunks.push({ index: chunks.length, heading, prefix: heading !== "" ? `${filename} · ${heading}` : filename, text: body });
    }
  }
  return chunks;
}
