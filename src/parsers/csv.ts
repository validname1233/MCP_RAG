// src/parsers/csv.ts —— 内置解析器：CSV（逗号分隔文本）。
// 与 xlsx 共享 tabular 序列化（表头判定 + 列名随行 + 类型推断 + 表档案）。
// 用极简 CSV 行解析器（处理引号内逗号/换行/转义），不引第三方依赖——
// 我们只需要行数组，不需要 csv-parse 的流式/变换能力。
//
// 注：csv 从 plain 的格式列表移出（plain 只管 txt/md/markdown/log）——
// 纯文本直读 CSV 会丢表头语义（调研报告 §3.3）。

import type { KbParser, ParsedDoc } from "./types.ts";
import { ParseError } from "./types.ts";
import { serializeTable } from "../tabular.ts";

// RFC 4180 精神的最小解析：引号包裹字段可含逗号/换行/"" 转义；分隔符自动嗅探
//（逗号/制表符/分号——取首行中出现最多的那个）
function parseCsv(raw: string): string[][] {
  const sniffer = raw.slice(0, raw.indexOf("\n") === -1 ? raw.length : raw.indexOf("\n"));
  const sep = [",", "\t", ";"].filter((s) => sniffer.includes(s)).sort((a, b) =>
    sniffer.split(b).length - sniffer.split(a).length)[0] ?? ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === sep) { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && raw[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// 值的类型推断（CSV 无类型元数据，靠猜）：日期/数字识别后交给 formatCell 统一格式化
function retype(rows: string[][]): unknown[][] {
  return rows.map((row) => row.map((v) => {
    const s = v.trim();
    if (s === "") return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) {
      const d = new Date(s.replace(/\//g, "-"));
      return isNaN(d.getTime()) ? v : d;
    }
    return v;
  }));
}

export const csvParser: KbParser = {
  name: "csv",
  formats: ["csv", "tsv"],

  async parse({ filename, data }): Promise<ParsedDoc> {
    if (data.length === 0) throw new ParseError("文件是空的");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data,
      );
    } catch {
      throw new ParseError("不是有效的 UTF-8 文本 CSV");
    }
    const rows = parseCsv(text);
    if (rows.length === 0) throw new ParseError("没有解析出任何行");

    const table = serializeTable(filename, retype(rows));
    if (table === null) throw new ParseError("没有有效数据行");

    return {
      text: table.text,
      sections: [{ heading: filename, text: `${table.profile}\n\n${table.text}` }],
    };
  },
};
