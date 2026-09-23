// src/tabular.ts —— 表格 → 文本的共享序列化模块（xlsx/csv 解析器共用）。
// 核心思想（调研报告 §3）：把二维表格翻译成"每行一句自含语义的话"——
// 列名随行、值按类型转成 embedding 友好的文字，外加每表一条 profile 档案块。

export interface TabularSection {
  heading: string;   // sheet/表名（进 chunk 前缀）
  text: string;      // 序列化后的行文本（每行一段）
  profile: string;   // 表档案：行列数、列名、数值统计——"这表有什么"的检索入口
}

// 值的类型化序列化：日期/数字/布尔 → 对 embedding 友好的文字；空值整体省略
export function formatCell(value: unknown, colName: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const y = value.getFullYear(), m = String(value.getMonth() + 1).padStart(2, "0"), d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    // 列名带计量暗示时拼上单位（锦上添花：让"8500"变成"8500元"更可检索）
    if (/工资|薪|价格|金额|费用|成本|余额|收入|支出|元/.test(colName)) return `${value}元`;
    if (/率|比|percent/i.test(colName)) return `${value}%`;
    return String(value);
  }
  const s = String(value).trim();
  return s === "" ? null : s;
}

// 表头判定（xlsx 场景）：第一行全字符串、且后面行同列出现类型化值（数字/日期/布尔）
// → 第一行在"描述"这些列，是表头。默认当作有表头（Excel 场景九成带），
// 反证（第一行也全同类型）才判无表头 → 伪造 列N(类型) 名。
//
// 大标题否决（2026-09-22 增强）：中文办公表常见"首行是大标题（合并单元格横跨
// 整表或只填 A1），第二行才是真表头"。特征：首行只有 1 个非空单元格。
// 剥掉它用下一行重判。护栏（防误伤单列表）：只剥【首行恰好 1 个非空、且
// 下一行有 ≥2 个非空】的形态——大标题的下一行是真表头/数据（多列），
// 而真单列表的下一行同样只有 1 个非空，不满足则不剥。
export function detectHeader(rows: unknown[][]): { header: string[]; dataRows: unknown[][] } {
  if (rows.length === 0) return { header: [], dataRows: [] };

  // 大标题否决（单层）：首行仅 1 个非空 + 次行 ≥2 个非空 → 剥首行重判
  const countNonEmpty = (row: unknown[]): number =>
    row.filter((v) => v !== null && v !== undefined && String(v ?? "").trim() !== "").length;
  if (rows.length > 1 && countNonEmpty(rows[0]) === 1 && countNonEmpty(rows[1]) >= 2) {
    return detectHeaderWithRules(rows.slice(1));
  }

  return detectHeaderWithRules(rows);
}

// 原判定主体（不含大标题否决）
function detectHeaderWithRules(rows: unknown[][]): { header: string[]; dataRows: unknown[][] } {
  if (rows.length === 0) return { header: [], dataRows: [] };
  const first = rows[0];
  const rest = rows.slice(1);

  const isTyped = (v: unknown): boolean =>
    typeof v === "number" || typeof v === "boolean" || v instanceof Date;

  const firstAllString = first.every((v) => v === null || v === undefined || v === "" || typeof v === "string");
  // 后续行中，任一列出现过类型化值（数字/日期/布尔）→ 与纯字符串首行形成
  // "类型断层" → 首行是表头。阈值 1：真实表常只有一列数字；全字符串名单
  //（0 列类型化）才走无表头分支。
  const typedCols = new Set<number>();
  for (const row of rest.slice(0, 30)) {
    for (let c = 0; c < row.length; c++) {
      if (isTyped(row[c])) typedCols.add(c);
    }
  }
  if (firstAllString && typedCols.size >= 1) {
    return { header: first.map((v, i) => String(v ?? "").trim() || `列${i + 1}`), dataRows: rest };
  }
  // 无表头（或拿不准）：伪造类型感知列名
  const width = Math.max(...rows.map((r) => r.length));
  const header2: string[] = [];
  for (let c = 0; c < width; c++) {
    const kind = guessColKind(rows.slice(0, 30).map((r) => r[c]));
    header2.push(`列${c + 1}${kind !== "" ? `(${kind})` : ""}`);
  }
  return { header: header2, dataRows: rows };
}

function guessColKind(values: unknown[]): string {
  const vs = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (vs.length === 0) return "";
  if (vs.every((v) => v instanceof Date)) return "日期";
  if (vs.every((v) => typeof v === "number")) return "数值";
  if (vs.every((v) => typeof v === "boolean")) return "布尔";
  return "";
}

// 主入口：行数据 → 序列化文本 + profile。
// rowsPerChunk 由调用方决定（chunker 按 section 切块时行组已是天然边界）。
export function serializeTable(tableName: string, rows: unknown[][]): TabularSection | null {
  const nonEmpty = rows.filter((r) => r.some((v) => v !== null && v !== undefined && String(v ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return null;

  const { header, dataRows } = detectHeader(nonEmpty);
  const lines: string[] = [];
  for (const row of dataRows) {
    const parts: string[] = [];
    for (let c = 0; c < header.length; c++) {
      const formatted = formatCell(row[c], header[c]);
      if (formatted !== null) parts.push(`${header[c]}: ${formatted}`);
    }
    if (parts.length > 0) lines.push(`${tableName} | ${parts.join(" | ")}`);
  }

  // profile：行列数、列名、数值列统计、样例——"这表有什么"的档案
  const stats: string[] = [];
  for (let c = 0; c < header.length; c++) {
    const nums = dataRows.map((r) => r[c]).filter((v): v is number => typeof v === "number");
    if (nums.length >= 2) {
      const sum = nums.reduce((a, b) => a + b, 0);
      stats.push(`${header[c]}: 数值列，${nums.length} 个值，最小 ${Math.min(...nums)}，最大 ${Math.max(...nums)}，合计 ${Math.round(sum * 100) / 100}`);
    }
  }
  const profile = [
    `【表档案】${tableName}：共 ${dataRows.length} 行 × ${header.length} 列。`,
    `列：${header.join("、")}。`,
    stats.length > 0 ? `统计：${stats.join("；")}。` : "",
    dataRows.length > 0 ? `首行示例：${lines[0] ?? ""}` : "",
  ].filter(Boolean).join("\n");

  return { heading: tableName, text: lines.join("\n\n"), profile };
}
