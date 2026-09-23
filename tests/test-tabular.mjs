
import { serializeTable, detectHeader } from "../src/tabular.ts";
let failed = 0;
const check = (n, c, d = "") => { console.log("  " + (c ? "✓" : "✗") + " " + n + (c ? "" : " " + d)); if (!c) failed++; };

// 1. 大标题否决：首行只有 A1 有值
const t1 = serializeTable("工资表.xlsx · Sheet1", [
  ["2026年9月员工工资表", null, null, null],
  ["姓名", "部门", "工资", "入职日期"],
  ["张三", "技术部", 8500, "2024-03-15"],
  ["李四", "市场部", 9200, "2023-11-01"],
]);
check("大标题被剥掉，真表头生效", t1.text.includes("姓名: 张三") && t1.text.includes("工资: 8500元"), t1.text.split("\n")[0]);
check("标题不出现在数据行", !t1.text.includes("员工工资表 | 姓名"));

// 2. 大标题 + 无表头（标题下一行就是数据）→ 伪列名
const t2 = serializeTable("清单.xlsx · S1", [
  ["购物清单", null],
  ["牛奶", 12],
  ["鸡蛋", 15],
]);
check("标题后无表头走伪列名", t2.text.includes("列2(数值): 12"), t2.text.split("\n")[0]);

// 3. 回归：正常表头不受影响
const t3 = serializeTable("正常.csv", [["姓名","工资"],["张三",8500],["李四",9200]]);
check("回归：正常表头", t3.text.includes("姓名: 张三"));

// 4. 回归：无表头纯数据表
const t4 = serializeTable("无头.csv", [[5, 10], [15, 20]]);
check("回归：无表头伪列名", t4.text.includes("列1(数值): 5"));

// 5. 单列表头（首行只有 1 个非空但那是真表头——极边界：两列中第二列全空）
const t5 = detectHeader([["名字", null], ["张三", null], ["李四", null]]);
// 全字符串单列表：大标题护栏不剥行（"名字"留在数据行），但类型断层检测
// 对纯字符串表触发不了 → 走伪列名分支（既有行为，与大标题无关）
check("单列表不被误剥行（首行保留在数据里）", JSON.stringify(t5.dataRows[0]) === '["名字",null]', JSON.stringify(t5.dataRows));

console.log(failed === 0 ? "\n全部通过 ✓" : "\n" + failed + " 项失败 ✗");
process.exit(failed === 0 ? 0 : 1);
