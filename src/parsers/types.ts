// src/parsers/types.ts —— 解析器契约（方案文档 §6.4）。
// 解析器只做"字节 → 纯文本"（可选章节结构）；切块/embedding/入库留在框架侧。
// 契约保持窄：进程内库与外部 HTTP 服务都要能实现它。

export interface ParsedDoc {
  // 全文纯文本。空文本 = 解析失败（调用方走回退链）
  text: string;
  // 可选结构：按章节切开的文本段，供切块阶段加标题前缀（§6.3）。没有就只填 text。
  sections?: Array<{ heading?: string; text: string }>;
}

export interface KbParser {
  // 注册名（日志/回退链展示用）
  name: string;
  // 声明可处理的扩展名（小写不含点）。多个格式可共用一个解析器（如 txt/md）
  formats: string[];
  parse(input: { filename: string; mime: string | null; data: Buffer }): Promise<ParsedDoc>;
}

// 解析失败的统一异常：message 会进 entries.error 展示给用户。
// 区别于"解析成功但内容为空"——后者走回退链（可能是扫描件误配数字解析器）。
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
