// src/parsers/registry.ts —— 解析器注册表 + 回退链匹配（方案文档 §6.4）。
// 与 bot 侧 adapters.ts 同款模式：Map 注册、代码内登记（不做配置文件/DSL）、
// 扩展名 → 候选列表。外部解析器（MinerU 等）将来包成 HTTP 适配器注册进来即可。

import type { KbParser, ParsedDoc } from "./types.ts";
import { ParseError } from "./types.ts";
import { plainParser } from "./plain.ts";

const registry = new Map<string, KbParser>();
const formatChains = new Map<string, KbParser[]>();

// 注册：同一扩展名可多次注册，后来者排在前（更专门的解析器后注册、优先尝试）
export function registerParser(parser: KbParser): void {
  registry.set(parser.name, parser);
  for (const fmt of parser.formats) {
    const chain = formatChains.get(fmt) ?? [];
    chain.unshift(parser);
    formatChains.set(fmt, chain);
  }
}

// 内置解析器在此登记。阶段二新增：pdf（pdf-parse）、docx（mammoth）；
// 阶段三：MinerU 外部解析器（HTTP 适配器）——都只是这里加一行。
registerParser(plainParser);

export function parsersFor(filename: string): KbParser[] {
  const dot = filename.lastIndexOf(".");
  if (dot === -1 || dot === filename.length - 1) return [];
  const ext = filename.slice(dot + 1).toLowerCase();
  return formatChains.get(ext) ?? [];
}

export interface ParseOutcome {
  ok: true;
  doc: ParsedDoc;
  usedParser: string;
  fellBackTo?: string; // 记录跳过了哪些候选（"pdf → mineru 降级"这类排查信息）
}

// 按回退链解析：前一个候选抛错或文本量过低（扫描件误配数字解析器的症状）时
// 自动降级下一个候选。全部失败时抛最后一个 ParseError（进 entries.error）。
export async function parseDocument(input: {
  filename: string;
  mime: string | null;
  data: Buffer;
}): Promise<ParseOutcome> {
  const chain = parsersFor(input.filename);
  if (chain.length === 0) {
    throw new ParseError(`不支持的文件格式：${input.filename}（目前支持 ${[...new Set([...formatChains.keys()])].join("、")}）`);
  }

  let lastError: ParseError = new ParseError("没有可用的解析器");
  const skipped: string[] = [];

  for (const parser of chain) {
    try {
      const doc = await parser.parse(input);
      // 文本量过低 = 疑似解析错对象（如扫描件 PDF 走了数字解析器）——降级下一个候选
      if (doc.text.trim().length < 10 && input.data.length > 1024) {
        skipped.push(parser.name);
        continue;
      }
      return { ok: true, doc, usedParser: parser.name, fellBackTo: skipped.join("→") || undefined };
    } catch (error) {
      skipped.push(parser.name);
      lastError = error instanceof ParseError ? error : new ParseError(`${parser.name} 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw lastError;
}
