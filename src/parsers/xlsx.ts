// src/parsers/xlsx.ts —— 内置解析器：Excel 工作簿（SheetJS 本地解析，用户决策：
// xlsx 走本地不走 MinerU——行级类型化序列化是本地定制的检索语义，云端表格转
// Markdown 反而丢"表头随行"）。
//
// 机制（调研报告 + 讨论定稿）：
// - XLSX.read：cellFormula:false（取公式计算后的缓存值）、cellDates:true（日期
//   序列数 → Date，别让 45553 进向量）
// - 合并单元格回填：sheet["!merges"] 的左上角值铺满整个区域（中文表极常见，
//   不回填则非左上角行大面积丢语义）
// - 每 sheet 独立走 tabular.serializeTable（表头判定 + 类型序列化 + profile）
// - 产出 sections（sheet 名 = heading），切块器按 sheet 边界切，行组天然无 overlap 需求

import * as XLSX from "xlsx";
import type { KbParser, ParsedDoc } from "./types.ts";
import { ParseError } from "./types.ts";
import { serializeTable } from "../tabular.ts";

export const xlsxParser: KbParser = {
  name: "xlsx",
  formats: ["xlsx", "xlsm", "xls"],  // .xls（BIFF8 及更早）SheetJS 同入口自动嗅探，2026-09-27 开放

  async parse({ filename, data }): Promise<ParsedDoc> {
    if (data.length === 0) throw new ParseError("文件是空的");

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(data, { type: "buffer", cellFormula: false, cellDates: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ParseError(`Excel 解析失败：${message.slice(0, 200)}`);
    }
    if (wb.SheetNames.length === 0) throw new ParseError("工作簿里没有任何工作表");

    const sections: Array<{ heading?: string; text: string }> = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (sheet === undefined) continue;

      // 合并单元格回填：把每个 merge 区域左上角的值写到区域内所有格子
      const merges = (sheet["!merges"] ?? []) as XLSX.Range[];
      if (merges.length > 0) {
        const grid = (sheet as unknown as Record<string, unknown>);
        for (const m of merges) {
          const startCell = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
          const val = grid[startCell];
          if (val === undefined || val === null) continue;
          for (let r = m.s.r; r <= m.e.r; r++) {
            for (let c = m.s.c; c <= m.e.c; c++) {
              const cell = XLSX.utils.encode_cell({ r, c });
              if (grid[cell] === undefined) grid[cell] = val;  // 只填空格，不覆盖真值
            }
          }
        }
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
      const table = serializeTable(`${filename} · ${sheetName}`, rows);
      if (table === null) continue;
      // 表档案作为该 sheet 的开头一段（检索"这表有什么"时命中档案）
      sections.push({ heading: sheetName, text: `${table.profile}\n\n${table.text}` });
    }

    if (sections.length === 0) throw new ParseError("所有工作表都是空的");
    const fullText = sections.map((s) => `## ${s.heading}\n\n${s.text}`).join("\n\n");
    return { text: fullText, sections };
  },
};
