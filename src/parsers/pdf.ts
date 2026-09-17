// src/parsers/pdf.ts —— 内置解析器：数字版 PDF（pdf-parse v2，纯 TS 无原生依赖）。
// 扫描件（图片型 PDF）没有文字层，getText 结果文本量极低——这个症状交由
// registry 的回退链兜住（fellBackTo / failed 提示），本解析器只负责如实报文本量。

import { PDFParse } from "pdf-parse";
import type { KbParser, ParsedDoc } from "./types.ts";
import { ParseError } from "./types.ts";

export const pdfParser: KbParser = {
  name: "pdf-parse",
  formats: ["pdf"],

  async parse({ filename, data }): Promise<ParsedDoc> {
    if (data.length === 0) throw new ParseError("文件是空的");
    // PDF 魔数快速校验（%PDF-）：省得把任意二进制喂给解析器报晦涩错误
    const head = data.subarray(0, 1024).toString("latin1");
    if (!head.includes("%PDF-")) {
      throw new ParseError("不是有效的 PDF 文件（缺少 PDF 文件头）");
    }

    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      const text = (result.text ?? "").trim();
      if (text === "") {
        // 空文本不是异常——回退链的"文本量过低"检测会接手（扫描件走这条路）
        return { text: "" };
      }
      void filename;
      return { text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/password/i.test(message)) {
        throw new ParseError("PDF 加密了，无法解析（请上传未加密版本）");
      }
      throw new ParseError(`PDF 解析失败：${message.slice(0, 200)}`);
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  },
};
