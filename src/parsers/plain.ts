// src/parsers/plain.ts —— 内置解析器：纯文本家族（txt / md / markdown 等）。
// 这些格式的"解析"就是字节按 UTF-8 读出来——共用一份代码。
// md 的标题/代码块结构留给切块阶段按行首语法识别，不属于"读文本"这层的职责。

import { ParseError, type KbParser, type ParsedDoc } from "./types.ts";

// 乱码启发式（两道）：
// ① UTF-8 严格解码失败的替换字符（U+FFFD）密度过高 → 编码不对（GBK 老文档/二进制）
// ② 可打印字符占比过低 → 解码"成功"但内容是控制符/二进制字节（如整片的 0x07）
// 正常文本（含中文、代码、Markdown 符号）的可打印占比应接近 1。
function looksLikeGarbage(text: string): boolean {
  if (text.length === 0) return false;
  let replacement = 0;
  let printable = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfffd) replacement++;
    // 允许：字母文字/中文等可见字符、空格、Tab、换行、回车；其余控制符算不可打印
    if (cp >= 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) printable++;
  }
  if (replacement > 4 && replacement / text.length > 0.001) return true;
  return printable / text.length < 0.9;
}

export const plainParser: KbParser = {
  name: "plain",
  formats: ["txt", "md", "markdown", "log"],

  async parse({ filename, data }): Promise<ParsedDoc> {
    if (data.length === 0) {
      throw new ParseError("文件是空的");
    }
    // 去掉 UTF-8 BOM（Windows 记事本遗产），否则首行标题/命令会带 \uFEFF
    let buf = data;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      buf = buf.subarray(3);
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      throw new ParseError("不是有效的 UTF-8 文本（如果是 Word/PDF 请用对应格式上传）");
    }
    if (looksLikeGarbage(text)) {
      throw new ParseError("内容看起来不是文本（解码出大量乱码或控制字符）");
    }
    void filename;
    return { text };
  },
};
