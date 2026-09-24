# gold.json 标注集独立审查报告（第三轮，md 批次）

- 日期：2026-09-24
- 审查范围：tests/gold.json Q65–Q84（恰好 20 条，gold 全部指向 tests/testdata/*.md 文档；Q1–Q44 见 tests/gold-review.md、Q45–Q64 见 tests/gold-review-round2.md，不再触碰）

## 审查方法

在 D:\TS\MCP_RAG（node v24.14.0）下，将任务书给定的单条验证脚本批量化运行（import 与调用完全一致：`parseDocument({filename, mime:null, data})` → `chunkDocument(f, text, sections)` → `chunks.filter(c => c.text.includes(snip))`），20 条全部实际走 **plain 解析器**（`usedParser=plain` 逐条确认）——md 原文按字节入库，**无 MinerU 错位风险，本地验证即线上事实**（这是与 pdf 批次的本质区别）。对每条一次性输出：块级命中数与命中块 idx/heading、snippet 在 md 源文件的原文出现次数、snippet 首次出现前后 ~320 字上下文（⏎ 标记换行）；唯一性检查遍历 `tests/.pdftext/*.txt`（50 个）+ `tests/testdata/*`（全部 157 个文件，含 97 个 md 与 pdf/xlsx 等）共 207 个文件的 `includes`。另做两组孪生扫描：① 20 组主题关键词（位置编码/注意力、PPO 家族、RAG 分块、MSCKF、hflip、Spring、LoRA、FastText、时钟、校园网、倒排索引、LayerNorm、权限、协程）在全 md 语料的分布；② 定点取证竞争文档原文（Q79 操作手册 /stop 段、Q83 调研报告面包屑段与 MCP 方案前缀段、Q77 阶段二报告 MSCKF 段、Q78 本周成果总结 hflip 段、Q69 题库倒排索引段）。任务书指定的三个特别核查点（Q79 /stop 功能、Q84 流程第 8 步、Q80 RM/Critic 去向）逐一对照 gold 原文与竞争文档原文核实。全部 20 条均实际运行验证，无凭直觉判定。

## 结论统计

- ✅ 通过 17 条：Q65, Q66, Q67, Q68, Q69, Q70, Q71, Q72, Q73, Q74, Q75, Q76, Q77, Q80, Q81, Q82, Q84
- ⚠️ 有风险 3 条：Q78, Q79, Q83
- ❌ 应修正 0 条

通用事实（适用于全部 20 条，单条不再重复）：snippet 全库唯一性检查**全部通过**（207 文件零跨文档撞车）；所有条目本地块级验证均 ≥1 块命中；原文出现次数除 Q83（2 次，定义与展开段各一、同块）外均为 1 次。本批 20 条覆盖 20 个不同 md 文档，无同文档多题。**11/20 为单块短文档（1/1 命中）**，多块文档 9 条（块数 2/2/2/3/6/6/15/19/49）。

---

## Q65

- query：RoPE旋转位置编码跟普通位置编码比，位置信息加在哪里
- gold：位置编码
- snippet：把位置编码到 Attention 的 Q/K 里面
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 335 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q65 | parser=plain | textlen=335
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…采用的是**绝对位置编码**。⏎对于第 i 个位置：Token Embedding + Position Embedding⏎…在进入第一层 Transformer 前加进去⏎…⏎### 旋转位置编码⏎RoPE⏎把位置编码到 Attention 的 Q/K 里面⏎```⏎X⏎ ↓⏎WQ → Q…天然可以表示相对位置
```
- 事实核对：query 断言"普通位置编码 ✓（原文有「### 普通位置编码」节：Token Embedding + Position Embedding，进第一层 Transformer 前相加）、RoPE ✓（「### 旋转位置编码 RoPE」）"，答案"加在 Q/K 里"即 snippet 本体，逐字对齐；对比结构（普通=嵌入前相加 / RoPE=编进 Q/K）在文内自洽成立。
- 风险：a) 335 字单块短文——整文档一个向量，但 query 专指词（RoPE、Q/K）恰是文档最高频主题词（RoPE 3 次），匹配面集中。b) 孪生：Transformer.md 含"位置编码"3 次（步骤 7/8 语境：位置编码生成/词嵌入+位置编码），Encoder和Decoder结构.md 无；但 "RoPE/旋转位置编码/Sin-Cos" 全库仅 gold，专名钉死。向量数据库.md/文档入库解析.md 的"位置信息"（各 1 次）是元数据语境，不同域。c) gold 文件名"位置编码"与 query 核心词重合，前缀参与 embedding 属偏易侧。
- 召回论证：query 的两技术名（RoPE vs 普通位置编码）正是文档两大标题节的对偶问法，问"加在哪里"必命中承载对比结构的唯一块。
- 结论：✅ 通过

## Q66

- query：Transformer为什么选LayerNorm而不是BatchNorm
- gold：层归一化（Layer Normalization）
- snippet：如果 Batch Size 太小，统计出的均值和方差就不准确
- 原文出现：1 次
- 块级验证：1/6 块命中（#1，heading「核心思想：为什么要用 Layer Norm？」）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q66 | parser=plain | textlen=1535
blockhit=1/6 idx=[1] heading=["核心思想：为什么要用 Layer Norm？"]
rawcount=1 collisions=无
ctx=…### 核心思想：为什么要用 Layer Norm？⏎…⏎- **Batch Norm 的问题：** BN 是在 **Batch（批次）** 维度上做归一化。如果 Batch Size 太小，统计出的均值和方差就不准确；且由于句子长度不一，BN 在处理填充（Padding）位置时会引入噪声。⏎⏎- **Layer Norm 的对策：** LN 是在 **单个样本的特征（Feature）** 维度上做归一化…
```
- 事实核对：query 问"为什么选 LN 不选 BN"，原文以 BN 两问题（batch 小→统计不准；padding 噪声）+ LN 对策作答——snippet 承载问题一，问题二（Padding 噪声）与 LN 对策在同一 bullet 对里、同块可读，答案完整。
- 风险：b) LayerNorm 字样散见 5 文档（修改方案报告_2026-08-22 5 次、R1网络结构 2 次、Transformer.md/P0系列各 1 次），但均为网络配置语境；**"Batch Norm"表述全库仅 gold 1 次**，BN↔LN 的对比性内容唯一在 gold。c) 文件名与 query 主题词重合（Layer Normalization），偏易侧。
- 召回论证：query 就是"核心思想：为什么要用 Layer Norm？"标题节的问句化，snippet 是该节 BN 问题 bullet 的谓语本体，标题词+内容词双对齐。
- 结论：✅ 通过

## Q67

- query：Java不可变类的字段如果引用了可变对象， getter要怎么处理
- gold：不可变类
- snippet：如果字段引用了可变对象，getter必须返回副本
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 182 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q67 | parser=plain | textlen=182
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…必须满足5个条件⏎1）类声明为final⏎2）所有字段都是private final…⏎4）不提供任何setter或修改状态的方法⏎5）如果字段引用了可变对象，getter必须返回副本
```
- 事实核对：query 断言与原文五条件之第 5 条逐字一致（字段引用可变对象 → getter 必须返回副本），答案即 snippet 整句。
- 风险：a) 182 字单块——本批最短文档之一，但 query 几乎是原文条件句的原样问句化，专指性强（getter/副本/可变对象组合全库唯一）。b) 无孪生：Java16.md 的"不可变"1 次、Bean.md 无相关词，均不同域。
- 召回论证：query 三词组（不可变类/字段引用可变对象/getter）唯一交汇于该 182 字文档，问处理方式即问第五条，snippet 是条件句本体。
- 结论：✅ 通过

## Q68

- query：Java序列化的时候怎么跳过敏感字段不写入
- gold：序列化和反序列化
- snippet：序列化时自动跳过
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 767 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q68 | parser=plain | textlen=767
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…| **怎么防** | 敏感字段加 `transient` 关键字，序列化时自动跳过            |⏎| **怎么稳** | 显式定义 `serialVersionUID`…⏎```java⏎public class User implements Serializable {⏎    private transient String password;  // transient = 不参与序列化
```
- 事实核对：query 问"怎么跳过敏感字段"，原文"敏感字段加 transient 关键字，序列化时自动跳过"——snippet 取效果短语（避开反引号包裹的 transient 字面量，与 gold note 一致），答案主体（transient 关键字）在锚点左侧同表格行同块，答案完整可得；代码示例同块二证。
- 风险：a) 8 字短锚点（本批最短之一），当前全库唯一——md 语料不会像 pdf 那样因重提取漂移，唯一性稳定；transient 4 次、Serializable 2 次均仅 gold。b) 无孪生。
- 召回论证：序列化主题孤本（transient/Serializable 全库唯一），问跳过字段即问"怎么防"行，snippet 是该行谓语。
- 结论：✅ 通过

## Q69

- query：Elasticsearch的倒排索引和普通数据库找数据的方式有什么不同
- gold：Elasticsearch
- snippet：倒排索引可以通过内容找出现在哪些文档
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 453 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q69 | parser=plain | textlen=453
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…#### 倒排索引⏎普通数据库通过文档找内容⏎倒排索引可以通过内容找现在在哪些文档⏎⏎ES入库时看上去像JSON的键值对…| docId | 哪篇文档 |⏎| tf | 出现次数 |…
```
- 事实核对：query 问"倒排 vs 普通数据库找数据方式"，原文两行对偶句"普通数据库通过文档找内容 / 倒排索引可以通过内容找现在在哪些文档"——snippet 是答案下半句，上半句（对照面）紧邻同块，对比结构完整。
- 风险：b) 值得记录的同域竞争——题库.md（Elasticsearch 4 次）有一段"为什么选 ES 而不是向量数据库"的选型问答，其中提到"全文检索、倒排索引、条件过滤"；向量数据库.md（Elasticsearch 5 次）同域。但两处"倒排索引"均为选型罗列语境，**不含"倒排 vs 普通数据库"的机制对比**，snippet 全库唯一在 gold。干扰强度：中低（文档召回端可能分流，答案端无竞争）。
- 召回论证：问倒排索引的机制差异，唯一展开该对比的文本是 gold 的倒排索引节，snippet 是对偶句本体；docId/tf/pos 表同块补充。
- 结论：✅ 通过

## Q70

- query：Python协程和普通函数最本质的区别是什么
- gold：异步（Python）
- snippet：可以"暂停和恢复"的函数
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 644 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q70 | parser=plain | textlen=644
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…### 协程（Coroutine）⏎可以"暂停和恢复"的函数⏎普通函数```⏎```python⏎def f():…⏎不能中途停⏎⏎协程⏎```python⏎async def f():…⏎可以在中间暂停（await）⏎ 以后再继续
```
- 事实核对：query 问"协程 vs 普通函数最本质区别"，原文定义句"可以'暂停和恢复'的函数"＋双代码对照（普通函数"不能中途停"/协程"可以在中间暂停（await）"）——snippet 即区别本体，对照证据同块。中文弯引号在 plain 逐字节入库下无变形风险。
- 风险：a) 644 字单块，含大段代码——向量语义被代码稀释一些，但"协程"全库 3 次全在 gold，query 专指词密度高。b) async/await 字样散见 14 个 TS 设计文档（代码语境），但"协程"仅 gold——中文术语钉死。c) 文件名"异步（Python）"与 query 的 Python 重合，偏易侧。
- 召回论证："Python 协程"的中文表述唯一指向该文档协程节，snippet 是定义句本体，代码对照同块自证。
- 结论：✅ 通过

## Q71

- query：LoRA微调为什么能省那么多显存
- gold：显存计算
- snippet：LoRA冻结了源模型的参数
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 257 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q71 | parser=plain | textlen=257
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…2. 模型参数⏎3. 优化器（一次动量、二次动量、模型参数）⏎4. 激活值…⏎5. 梯度值（约等于参数大小）⏎⏎LoRA微调时可以大幅度减小优化器和激活值中的显存占用，因为优化器必须为源模型的全部从参数维护状态，LoRA冻结了源模型的参数。另外，全量微调需要计算源模型所有参数的梯度，LoRA只计算LoRA旁路矩阵A和B的梯度，源模型的梯度计算被跳过。
```
- 事实核对：query 问"为什么省显存"，原文给出双机理：①冻结→优化器不必为全参数维护状态（snippet 承载核心断言）；②跳过源模型梯度。snippet 承载机理一，机理二紧随同句同块，答案完整。小注：原文"全部从参数"系笔误（应为"的"），snippet 本身干净无涉。
- 风险：a) 257 字单块，整文档即"显存五项+LoRA 省显存"，主题高度聚焦。b) LoRA 字样另见微调类型.md（4 次）、面试模拟.md（3 次）——均为概念/面试语境；**"显存"一词全库仅显存计算.md（正文 1 次+即 snippet 所在句）与 PPO.md（1 次）出现**，LoRA×显存交集唯一在 gold，query 的"显存"就是区分词。c) gold 文件名"显存计算"恰为 query 答案侧词汇——query 侧（LoRA 微调）与文件名不重合，难度设计合理。
- 召回论证：query 双要素（LoRA+显存）全库唯一交汇于该短文，问原因即问因果句，snippet 是从句核心（冻结源模型参数）。
- 结论：✅ 通过

## Q72

- query：DPO训练时模型参数朝什么方向调整算是学到了偏好
- gold：DPO
- snippet：只要能让"好回答的相对概率变高，坏回答的相对概率变低"
- 原文出现：1 次
- 块级验证：1/2 块命中（#1）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q72 | parser=plain | textlen=1348
blockhit=1/2 idx=[1] heading=[""]
rawcount=1 collisions=无
ctx=…**核心思想：**⏎DPO 相当于把"训练 Reward Model"和"用 Reward 训练 Actor"这两步，在数学上**合并成了一步**。模型在调整参数时，只要能让"好回答的相对概率变高，坏回答的相对概率变低"，就同时完成了"理解人类偏好"和"优化自身策略"两件事。
```
- 事实核对：query 问"参数朝什么方向调整算学到了偏好"，原文核心思想句的条件从句即答案（好回答相对概率变高/坏回答变低），snippet 逐字承载；"偏好"落点（理解人类偏好）在同句句尾，对齐精确。
- 风险：b) PPO 家族三文档同库（PPO.md：Critic 28 次/Reward Model 6 次；GRPO.md：DPO 2 次、偏好 0）——DPO 字样在 GRPO.md 仅 2 次（对比语境），"相对概率/偏好"组合唯一在 gold，query 主体词 DPO 高密度（gold 5 次）钉定。另发现 gold note 瑕疵：**"与 Q3（核心思想）同文档不同侧面"引用的是已删除的旧 md 批次编号，按当前 gold.json 会误指 pdf 批次的 Q3（昆虫性信息素）**——建议后续修订 note 时标注"旧 md 批次"（Q79 的 note 就正确写了"旧md批次已删"）。
- 召回论证：query 是核心思想句从句的问句化改写（调整方向=概率变化方向），"DPO+偏好"唯一指向 gold，snippet 即答案从句。
- 结论：✅ 通过

## Q73

- query：注意力公式里为什么要对QK乘积除以根号dk
- gold：Attention机制
- snippet：除以d_k之后，保证每一排方差仍然为1
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 128 字单块——本批最小文档）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q73 | parser=plain | textlen=128
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…核心功能：考虑别的所有Token对于当前Token在语义空间中的影响（使）⏎⏎计算注意力得分：⏎Q × K^ T = 注意力得分矩阵⏎为什么要/根号d_k：⏎原来的QK向量都是均值为0方差为1，除以d_k之后，保证每一排方差仍然为1。并且缩放之后数值适中
```
- 事实核对：query 断言"除以根号 dk ✓（原文标题行"为什么要/根号d_k"）"，答案（保方差为 1+数值适中）即 snippet 及其后半句，同块完整。原文首行"（使）"为源文件残留字符，不影响 QA。
- 风险：a) 128 字单块，语义最集中的一题。b) 孪生家族真实但可分：注意力/Attention 字样散见 Encoder和Decoder结构.md（6+8 次）、R1网络结构（15+2 次）、Transformer.md（2 次）、微调类型等 6 文档——但 **"根号/d_k/Q × K"全库仅 gold**，公式的 scale 机理唯一在 gold；query 的"根号dk"就是区分词。c) 文件名是英文"Attention机制"而 query 用中文"注意力"——跨语言匹配（内容里两字"注意力"在），不构成偏易。
- 召回论证：问 scaled attention 的机理，唯一承载该推导的文本就是这个 128 字孤本，snippet 是结论句本体（方差保持），均值方差前提同句。
- 结论：✅ 通过

## Q74

- query：Spring什么是循环依赖问题
- gold：Spring循环依赖
- snippet：导致 Spring 在创建对象时绕不出来
- 原文出现：1 次
- 块级验证：1/2 块命中（#0）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q74 | parser=plain | textlen=1369
blockhit=1/2 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…Bean A 依赖 Bean B，Bean B 又依赖 Bean A，导致 Spring 在创建对象时绕不出来。⏎## 构造器注入⏎```java⏎@Service⏎public class AService {…
```
- 事实核对：query 问"什么是循环依赖"，原文定义句"Bean A 依赖 Bean B，Bean B 又依赖 Bean A，导致 Spring 在创建对象时绕不出来"——snippet 取后果半句，定义半句（A依赖B、B又依赖A）在锚点左侧同句同块，答案完整。措辞小注：query"Spring什么是循环依赖"语序生硬（缺标点分隔），非事实错误。
- 风险：b) 无孪生——Spring 框架.md（同主题家族文件）0 次"循环依赖/三级缓存"，"循环依赖/三级缓存/Bean A"全库唯一 gold。c) 文件名与 query 主体词完全重合，前缀 lexical 加分偏易。
- 召回论证：query 即文档首句定义的问句化，"Spring+循环依赖"全库唯一锚定，snippet 是定义句谓语（绕不出来=循环的字面后果）。
- 结论：✅ 通过

## Q75

- query：为什么大模型不知道今天几号，给它加时钟工具的问题背景是什么
- gold：问题复盘_2026-09-18_模型对时间无感知get_time工具
- snippet：训练数据有截止日期，推理时也没有任何时钟输入
- 原文出现：1 次
- 块级验证：1/6 块命中（#1，heading「1. 问题」）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q75 | parser=plain | textlen=1724
blockhit=1/6 idx=[1] heading=["1. 问题"]
rawcount=1 collisions=无
ctx=…## 1. 问题⏎模型对"今天几号、现在几点"没有可靠感知——训练数据有截止日期，推理时也没有任何时钟输入。后果：⏎- 用户问"今天星期几"…模型静默编造一个日期；⏎- 用户要"最近的 XX 新闻"…"最近"锚定在哪…也是编的。
```
- 事实核对：query 断言"大模型不知道今天几号 ✓（原文"对'今天几号、现在几点'没有可靠感知"）、加时钟工具 ✓（get_time 工具，§2）"，snippet 是病因句本体（训练截止+无时钟输入），与"问题背景"问法对齐精确。
- 风险：b) 同域引用链：进度推送Bus设计方案（get_time 2 次）、同日姊妹复盘《调工具后答案被丢弃》（get_time 1 次，且 gold 首部互引）——均为实现语境不载病因句；"时钟输入/截止日期"组合唯一 gold，时钟在 EKF阶段二报告的 1 次是硬件时钟，不同域。c) 文件名长且含"模型对时间无感知"，query 语义与文件名高度同向，前缀偏易侧。
- 召回论证：query 前半就是 §1 问题节首句的转述，问背景必召回该节块；"时钟工具"指向 get_time 系列文档中唯一写病因的一篇。
- 结论：✅ 通过

## Q76

- query：校园网DPI防火墙的穿透方案里，流量伪装成什么样的外观
- gold：Headscale校园网穿透复盘报告
- snippet：所有穿越校园网防火墙的流量在外观上均为标准 HTTPS / WebSocket
- 原文出现：1 次
- 块级验证：1/49 块命中（#0，heading「Headscale × 校园网（教育网）穿透 · 全程复盘报告」——头部元信息块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q76 | parser=plain | textlen=21938
blockhit=1/49 idx=[0] heading=["Headscale × 校园网（教育网）穿透 · 全程复盘报告"]
rawcount=1 collisions=无
ctx=…> **最终结果**：lab3090 ↔ desktop-7kopp2t 双向互通（DERP 中继 ~56ms，0% 丢包），所有穿越校园网防火墙的流量在外观上均为标准 HTTPS / WebSocket⏎---⏎## 0. 太长不看版（TL;DR）⏎校园网（教育网出口）的 **DPI 设备会识别并丢弃…**"Go 程序的 TLS 指纹 + ALPN 不含 h2"**…
```
- 事实核对：query 断言"DPI ✓（TL;DR：DPI 设备会识别并丢弃…）、穿透方案 ✓（Headscale+wstunnel）、外观 → 标准 HTTPS / WebSocket ✓"——snippet 即"最终结果"句的谓语，逐词对齐；斜杠/空格等英文标点在 plain 下无变形。
- 风险：b) 无孪生——校园网 12 次/DPI 24 次/穿透 3 次全库唯一 gold（deep-web-browsing 的"穿透"1 次是动词语境）。锚点在 21938 字大文档的头部块——与 pdf 批次"摘要块承载锚点"同型；检索需把头部 TL;DR 块送进 top-K，属难题。c) 文件名"校园网穿透"与 query 两词重合，前缀 lexical 帮助定位头部块（heading 里也有），是难度缓冲。
- 召回论证：问伪装外观就是问"最终结果"行，唯一证据在头部块；DPI×防火墙×校园网的词族密度全库仅此一篇。
- 结论：✅ 通过

## Q77

- query：MSCKF在EKF-VIO领域是什么地位
- gold：EKF-VIO系统流程详解_2026-09-06
- snippet：MSCKF（Multi-State Constraint Kalman Filter）——EKF-VIO 的经典范式
- 原文出现：1 次
- 块级验证：1/19 块命中（#0，头部元信息块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q77 | parser=plain | textlen=6235
blockhit=1/19 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…# 经典 EKF-VIO 系统流程详解⏎## ——基于 MSCKF 框架的视觉-惯性里程计教学文档⏎> 日期：2026-09-06⏎> 定位：SLAM 估计理论学习笔记…⏎> 框架：MSCKF（Multi-State Constraint Kalman Filter）——EKF-VIO 的经典范式，VINS-Fusion 滤波版、s-MSCKF 等均此骨架
```
- 事实核对：query 问"地位"，原文定位行"MSCKF——EKF-VIO 的经典范式，VINS-Fusion 滤波版、s-MSCKF 等均此骨架"——snippet 含答案（经典范式）+例证补语（同块同行），对齐精确；含全角破折号/括号英文，plain 下无变形。
- 风险：b) 孪生：EKF阶段二实验报告（MSCKF 2 次）——语境是"TLIO/MSCKF 用预积分和 FEJ 解决的问题""或直接 MSCKF 框架换量测源"，是把手搓失败实验对标成熟实现的引用，**不含"地位/范式"定性句**；"经典范式"全库唯一 gold。c) 文件名含"EKF-VIO"（query 主体词），前缀偏易，同时是对抗阶段二报告的钉子。
- 召回论证：问 MSCKF 的领域地位，唯一定性句在 gold 头部引用块，"MSCKF+EKF-VIO"双词在两文档共现但"经典范式"只此一处；19 块文档锚点在头部，中低难度。
- 结论：✅ 通过

## Q78

- query：hflip消融实验里，预训练对照组之间控制了什么变量
- gold：微调实验汇报_hflip有效性与对标开源_2026-09-11
- snippet：唯一系统差异是 hflip 是否贯穿
- 原文出现：1 次
- 块级验证：2/15 块命中（#2、#3——同一处文本被 80 字块重叠双载，原文仅 1 次）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q78 | parser=plain | textlen=5754
blockhit=2/15 idx=[2,3] heading=["1.1 我们的微调系列（同一预训练配方下的受控对比）","1.2 增强消融（KITTI 直训 120ep，同架构同初始化）"]
rawcount=1 collisions=无
ctx=…（三者共享：TartanAir 18 环境预训练 + 冻结视觉前端微调 + 相同 lr/batch/seed；50ep 版与 07-07 版的预训练源同为各自配方下的 50/40ep 收官权重，唯一系统差异是 hflip 是否贯穿。）
```
- 事实核对：query 断言"hflip 消融 ✓（文档 §1.2「增强消融」节+全文消融 2 次）、预训练对照组 ✓（§1.1 标题即「同一预训练配方下的受控对比」，括号句主语为"50ep 版与 07-07 版的预训练源"）"——snippet 即受控设计的结论（共享清单+唯一差异），控制面（同环境/冻结前端/同 lr/batch/seed）与操纵面（hflip 贯穿与否）在同一括号句内，答案完整。措辞小注：query"控制了什么变量"严格说答案是"共享清单"，snippet 承载的是"未控制的那一个"（hflip）——但受控实验语义下"唯一系统差异"正是控制变量的对偶表述，同句可读，无矛盾。
- 风险：⚠ b) **md 语料最大的同主题家族**——hflip 字样散见 7 文档（纯hflip几何一致性增强实验报告 37 次、本周研究成果总结 14 次、误差来源分析_G4与纯hflip 12 次、几何一致性增强方案/总结各 7 次、EuRoC基线 1 次），"预训练"在纯hflip报告 8 次、本周成果 11 次、R2四策略 11 次；几何一致性增强方案另有"对照组+唯一差异"同构表述、纯hflip报告也有"唯一差异"1 次、本周成果有"除时长外配置同源"同构句。query 核心词（hflip/消融/预训练）在 ≥3 个竞争文档共现，区分词（受控对比/贯穿）部分在 query 侧部分在答案侧——文档召回竞争真实，snippet 端无竞争。
- 召回论证：问对照组间的受控变量设计，唯一直接作答的是 §1.1 表格下方的括号说明句，snippet 是该句结论半段；2/15 双块承载（重叠复制）对 snippet 命中是缓冲。
- 结论：⚠️ 有风险（hflip 实验家族 7 文档同主题高密度，文档召回可能分流；建议评测时观察纯hflip报告/本周成果与 gold 的排名，或接受为"抗同家族干扰"测例）

## Q79

- query：《命令速查表》里 /stop 命令是干什么用的
- gold：2026-08-31-命令速查表
- snippet：每个会话同时只能跑一个长任务
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，heading「命令速查表」，全文 773 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q79 | parser=plain | textlen=773
blockhit=1/1 idx=[0] heading=["命令速查表"]
rawcount=1 collisions=无
ctx=…**命令：`/stop`（`/停止`）**⏎功能：强制中断自己正在跑的 /Agent 或 /深度检索 任务，立即确认。每个会话同时只能跑一个长任务，重复发起会提示先 /stop。
```
- 事实核对（任务书特别核查项）：/stop 条目原文为"功能：强制中断自己正在跑的 /Agent 或 /深度检索 任务，立即确认。每个会话同时只能跑一个长任务，重复发起会提示先 /stop。"——**query 的答案（强制中断长任务）与 snippet（并发约束句）在同一行同一块**，snippet 命中即答案可得，事实无矛盾。但 gold note 的锚点理由不实：**"功能主句「强制中断…」跨行弃用"与源文件不符——md 源第 9 行是单行**（plain 逐字节入库，无跨行问题），本批本无断行风险。真实起效的是另一个（未被记录的）机制：功能句里的"强制中断"与操作手册撞词（见下），约束句的措辞差异恰好实现了全库唯一——歪打正着，note 应改写。
- 风险：⚠ b) **同命令双文档孪生（本批最强）**——2026-08-31-操作手册.md 有"### 强制中断"专节：/stop 3 次、强制中断 3 次、长任务 1 次，且含更详尽的功能描述（AbortController 机制、按人粒度会话隔离），**并 5 次提及"命令速查表"**（自述"浓缩版操作手册…读 docs/features/2026-08-31-命令速查表.md 的内容"＋附表）。query 的文档名限定词《命令速查表》在竞争文档中也高频出现，词法钉定被削弱；嵌入检索下操作手册 /stop 段（更长更详）完全可能抢走首位。snippet 端因措辞差异（速查表"只能跑一个长任务" vs 操作手册"只允许一个长任务在跑"）保住全库唯一，snippet 命中可正确判别两文。
- 召回论证：带书名问 /stop 功能，gold 唯一块承载完整条目；但操作手册的同名专节是同内容派生文档，召回排序竞争真实（速查表 773 字单块整体向量 vs 操作手册 /stop 局部段落）。
- 结论：⚠️ 有风险（操作手册派生孪生可抢文档召回首位；snippet 唯一性完好；另 gold note 的"跨行弃用"理由不实应改写——实际避开了与操作手册的措辞重叠）

## Q80

- query：GRPO里Reward Model和Critic Model各自的去向是什么
- gold：GRPO
- snippet：或换成 Rule-based 规则打分
- 原文出现：1 次
- 块级验证：1/3 块命中（#0——三模型对比表所在块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q80 | parser=plain | textlen=1524
blockhit=1/3 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…|**Reward Model** (裁判)|✅ 冻结，当裁判打分|❌ 彻底砍掉|✅ **保留** (或换成 Rule-based 规则打分)|⏎|**Critic Model** (助教)|✅ 解冻，实时预估分值|❌ 彻底砍掉|❌ **彻底砍掉**|⏎如果说 DPO 的思路是…那么 GRPO 的思路则是："…我们必须把 Critic Model 干掉。**"
```
- 事实核对（任务书特别核查项）：对照对比表逐格核实——GRPO 列：Actor 解冻训练、Ref_Model 冻结算 KL、**Reward Model=✅ 保留（或换成 Rule-based 规则打分）**、**Critic Model=❌ 彻底砍掉**；表格下方段落再证（"把 Critic Model 干掉"）。snippet 承载 RM 去向的替换支（规则打分），RM 的主去向（保留）与 Critic 的去向（彻底砍掉）在同一表格行/同块，两问答案完整可得。小注：snippet 以"或"开头非自含主语，主语（Reward Model 保留）在同行左侧——块级口径下无碍。
- 风险：b) 任务书点名的"PPO 三兄弟"竞争**真实存在**：PPO.md（Critic 28 次、Reward Model 6 次、Actor 28 次）与 DPO.md（"彻底砍掉"2 次）同库，DPO 文的表格对同一问题给出不同答案（RM/Critic 均砍）。但 query 主体词"GRPO"全库唯一 gold（7 次，PPO/DPO 文 0 次），词法钉死；答案侧"Rule-based/规则打分"也唯一 gold。
- 召回论证：问 GRPO 的模型角色去向，唯一展开 GRPO 三列对比的就是该表；"GRPO+Reward Model+Critic"三词交集唯一 gold，snippet 是 RM 行的替换支。
- 结论：✅ 通过

## Q81

- query：工具权限的判定规则是什么顺序
- gold：工具调用的安全性
- snippet：判定逻辑从上到下，命中即返回
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 304 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q81 | parser=plain | textlen=304
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…### Permission Stack⏎判定逻辑从上到下，命中即返回⏎1. BYPASS模式？->直接全部放行⏎2. 在READ_ONLY_TOOLS白名单中？->安全工具放行⏎3. 在EDIT_TOOLS白名单中？->ACCEPT_EDITS模式下放行，默认模式需要ASK⏎4. 不在任何白名单中？->ASK…直接DENY
```
- 事实核对：query 问"判定规则什么顺序"，原文 Permission Stack 节"判定逻辑从上到下，命中即返回"+4 级阶梯（BYPASS→白名单→EDIT 白名单→ASK/DENY）——snippet 即顺序总则，具体阶梯同块，答案完整。
- 风险：a) 304 字单块，主题聚焦（PreToolUse Hook+Permission Stack）。b) "白名单"散见 3 文档（deep-web-browsing 2 次、租户复盘/Headscale 各 1 次）均为无关语境；"Permission/BYPASS/判定逻辑"全库唯一 gold。c) query"工具权限"与文件名"工具调用的安全性"不同字面，语义题考法合理。
- 召回论证：问权限判定顺序，唯一展开该机制的是 Permission Stack 节，snippet 是总则句本体，四层枚举同块自证。
- 结论：✅ 通过

## Q82

- query：互联网语料清洗的流程里语言过滤那一步用什么工具
- gold：互联网数据处理（清洗、去重、去隐私）
- snippet：FastText语言检测与智能过滤
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 417 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q82 | parser=plain | textlen=417
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…### URL Filtering⏎基于黑名单的内容过滤系统…⏎### Text Extraction⏎HTML解析，提取高质量文本输出⏎⏎### Language Filtering⏎FastText语言检测与智能过滤⏎⏎### Gopher Filtering⏎MassiveText启发的多维度文档质量评估…
```
- 事实核对：query 断言"流程 ✓（URL/Text/Language/Gopher/PII/MinHash 流水线）、语言过滤那一步 ✓（### Language Filtering 节）"，答案（FastText）即 snippet 主体，逐字对齐。
- 风险：a) 417 字单块——流程大纲型笔记，单向量覆盖全部环节名词，query 点名"语言过滤"这一节名，专指足够。b) 无孪生：**FastText 全库唯一**；benchmark 调研文（chunk 4 次）不含该词。c) 文件名"互联网数据处理（清洗…）"与 query"互联网语料清洗"两词重合，前缀偏易。
- 召回论证：query 的"语言过滤"是文档五级流程之一的小节标题原词，问工具即问该节内容行，snippet 即答案。
- 结论：✅ 通过

## Q83

- query：RAG分块的时候给每个片段加上文档标题或章节标题，这种技术叫什么
- gold：RAG优化策略
- snippet：上下文片段标题（CCH）
- 原文出现：2 次（定义句+展开段，均在同一块）
- 块级验证：1/2 块命中（#0）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q83 | parser=plain | textlen=1290
blockhit=1/2 idx=[0] heading=[""]
rawcount=2 collisions=无
ctx=…上下文增强检索的rag：返回片段进行上下文扩展…⏎简单RAG中的上下文片段标题（CCH）：标准的分块方法经常丢失重要上下文，从而使检索效果降低。⏎上下文片段标题（CCH）通过在嵌入每个片段之前为其添加高级上下文（如文档标题或章节标题）来增强RAG。这提高了检索质量并防止了脱离上下文的回复。
```
- 事实核对：query 描述（分块时给每个片段加文档标题或章节标题）与原文展开句"通过在嵌入每个片段之前为其添加高级上下文（如文档标题或章节标题）"逐词吻合，snippet 即术语名本体（CCH），1 次定义+1 次展开双证。
- 风险：⚠ b) 任务书点名的孪生**双份坐实**：①2026-09-17-RAG文档分块调研报告.md（分块 13 次、chunk 18 次）载有"**面包屑注入（共识）：`文档名 > 章 > 节` 前缀进每个 chunk 再 embedding**"及"语义保留三板斧：面包屑前缀、parent-child、contextual retrieval"——**同一技术的另一个名字**，且该文还提到 Anthropic contextual retrieval（LLM 生成块上下文，检索失败率 −49%~−67%）这个近邻术语；②2026-09-04-知识库RAG-MCP方案.md 载"切块（500~800 token，带文档名+章节标题前缀）"——**本项目自己的同类设计**（chunker prefix，gold note 亦自注"本项目 chunker 的 prefix 即同类思想"）。query 是"这种技术叫什么"的**术语问句**：正确答案唯一（CCH，snippet 全库唯一），但两个竞争文档对同一操作各有称谓（面包屑/前缀），语义上都能"回答"该 query 的描述部分——文档召回竞争真实且答案术语跨文档分裂，是本批唯一"问名"型撞车。
- 召回论证：query 的操作描述（每个片段+文档标题或章节标题）与 gold 展开句几乎逐词同构（原文括号里就是"文档标题或章节标题"六字），术语名只在 gold；但调研报告的面包屑句、MCP 方案的前缀句是同一操作的不同表述，均可吸走召回。
- 结论：⚠️ 有风险（"面包屑前缀"＝CCH 同物异名且在分块调研报告/MCP 方案双文档出现，术语问句的召回竞争与答案分裂真实；snippet 唯一性完好，建议评测时单独观察三文排名）

## Q84

- query：《Transformer》笔记里推理流程中词嵌入和位置编码是怎么合并的
- gold：Transformer
- snippet：词嵌入+位置编码（element-wise addition）
- 原文出现：1 次
- 块级验证：1/1 块命中（#0，全文 482 字单块）
- 唯一性：全库唯一
- 实际输出（节选）：
```
=== Q84 | parser=plain | textlen=482
blockhit=1/1 idx=[0] heading=[""]
rawcount=1 collisions=无
ctx=…5. 嵌入层（embedding layer）⏎添加位置编码⏎6. 词嵌入向量（word embeddings）⏎7. 位置编码生成（positional encoding）⏎8. 词嵌入+位置编码（element-wise addition）⏎多头自注意力机制（multi-head self-attention）⏎9. 线性变换生成Q，K，V矩阵…
```
- 事实核对（任务书特别核查项）：流程清单核实——首行"推理步骤（从原始数据开始）："，步骤编号 1–15 连续；**第 7 步=位置编码生成、第 8 步=词嵌入+位置编码（element-wise addition）**，"第 8 步"归属无误；query 问"怎么合并"，答案（element-wise addition，逐元素相加）即 snippet 括号注，与位置编码.md 的"Token Embedding + Position Embedding"（相加）交叉一致。原文排版小瑕疵：第 8 与第 9 步之间的"多头自注意力机制"行无编号，不影响本题锚点。
- 风险：b) 内容孪生：位置编码.md 同样表述"Token Embedding + Position Embedding…进第一层 Transformer 前加进去"（同知识不同文）；文件名含 transformer 的另有本周研究成果总结（小写）。c) exact 题 query 带书名《Transformer》=文件名本体，词法钉死（设计使然）；"推理步骤"（非"流程"）一词也全库唯一 gold。
- 召回论证：带书名问流程步骤，唯一承载编号清单的就是该 482 字笔记，snippet 即第 8 步条目本体（含问法两词+答案注），exact 对齐无歧义。
- 结论：✅ 通过

---

## 汇总表

| id | verdict | 一句话原因 |
|----|---------|-----------|
| Q65 | ✅ | RoPE/普通位置编码对偶问 1/1；RoPE 全库唯一钉死；Transformer.md 轻度同域 |
| Q66 | ✅ | BN 两问题 bullet 1/6；Batch Norm 表述全库唯一；LayerNorm 散见 5 文档但均无 LN/BN 对比 |
| Q67 | ✅ | 五条件之第五条 1/1；getter/可变对象组合全库唯一；182 字孤本无孪生 |
| Q68 | ✅ | transient 效果短语 1/1；transient/Serializable 全库唯一；8 字短锚点在 md 下稳定 |
| Q69 | ✅ | 倒排 vs 普通数据库对偶句 1/1；题库/向量数据库为选型语境不答机制，中低干扰 |
| Q70 | ✅ | 协程定义句 1/1；"协程"全库唯一（async/await 散见 14 文档为代码语境） |
| Q71 | ✅ | 冻结→优化器免维护双机理句 1/1；LoRA×显存交集全库唯一（微调类型/面试模拟无显存） |
| Q72 | ✅ | 核心思想从句 1/2；DPO 高密度钉定；gold note 的"Q3"系旧批次失效引用 |
| Q73 | ✅ | 方差保持句 1/1（128 字最小文档）；根号/d_k 全库唯一，注意力家族 6 文档可分 |
| Q74 | ✅ | 定义句后果半段 1/2；Spring 框架.md 零相关词，真孤本；query 语序小疵 |
| Q75 | ✅ | 病因句 1/6（heading「1. 问题」）；get_time 引用链 3 文档均不载病因 |
| Q76 | ✅ | TL;DR 头部块 1/49；校园网/DPI/穿透全库唯一；大文档头部锚点属难题 |
| Q77 | ✅ | 定位句 1/19 头部块；"经典范式"全库唯一，阶段二报告 MSCKF 2 次为失败对标语境 |
| Q78 | ⚠️ | 受控设计句 2/15（重叠双载）；hflip 家族 7 文档同主题高密度（纯hflip报告 hflip 37 次），文档召回竞争真实 |
| Q79 | ⚠️ | /stop 条目 1/1、snippet 唯一；但操作手册派生孪生（/stop 3 次+强制中断 3 次+命令速查表 5 次）可抢召回；gold note"跨行弃用"理由不实（源文件单行） |
| Q80 | ✅ | 三模型表 RM 行 1/3；RM=保留可换规则打分、Critic=彻底砍掉逐格核实；GRPO 一词全库唯一钉死三兄弟 |
| Q81 | ✅ | Permission Stack 总则句 1/1；BYPASS/判定逻辑全库唯一；白名单散见 3 文档无关语境 |
| Q82 | ✅ | Language Filtering 节 1/1；FastText 全库唯一；文件名与 query 两词重合偏易 |
| Q83 | ⚠️ | CCH 定义+展开 1/2（原文 2 次同块）；面包屑前缀＝同物异名双文档坐实（调研报告+MCP 方案），"叫什么"型 query 召回与答案术语双竞争 |
| Q84 | ✅ | 第 8 步条目 1/1（编号核实 7=生成/8=相加）；exact 书名钉死；位置编码.md 为同知识异文 |

## 总体评价（与 pdf 批次 Q1–Q64 对比）

**结论质量**：第三轮 ✅17/⚠️3/❌0（通过率 85%），与第二轮持平（✅17/⚠️3/❌0），优于第一轮（✅34/⚠️9/❌1）。3 条 ⚠️ 全部是召回竞争型（b 类），无事实矛盾、无前提错位——任务书点名的三个特别核查点（Q79/Q80/Q84）事实断言全部核实成立；❌ 连续两轮为零。

**验证口径的代际变化——本地验证即线上事实**：pdf 批次两轮报告的核心系统性风险是"本地按 pdf-parse 验证、线上走 MinerU，断行/错位可能使 snippet 失配"（每轮尾部都要留"MinerU 入库后重跑"的提醒）。md 走 plain 逐字节入库，本轮 20 条的块级命中、原文次数、全库唯一性**全部是线上事实**，不存在重提取漂移——因此本批锚点可以放心使用含空格/斜杠/括号/中文弯引号/下标记号（d_k）的形态（Q66/Q70/Q73/Q76/Q77/Q84），这在 pdf 批次是需要刻意规避的。风险面整体从"提取稳定性"迁移到"语料拓扑"。

**md 语料的特有风险——派生/孪生文档密度远高于 pdf**：pdf 批次是学术孤本（一篇论文一个主题），md 语料是同一项目的设计/复盘/汇报文档，天然互相引用、内容复述。本轮 3 条 ⚠️ 全部由此而来：Q79 命令速查表 vs 操作手册（同一命令的两个详略版本，操作手册还 5 次提及速查表）、Q83 RAG优化策略 vs 分块调研报告+MCP 方案（同一技术三个称谓：CCH/面包屑/前缀，且"这种技术叫什么"型 query 对称谓分裂最敏感）、Q78 hflip 实验家族（同一实验系列的 7 份文档）。pdf 批次的 ⚠️ 是"同物异名/同题异文"偶发；md 批次这是**结构性现象**——后续给 md 语料加题时，应把"该主题在本项目文档里有几份派生版本"当作第一道检查。

**单块短文档对评测口径的影响（本轮最重要的结构性观察）**：20 条中 11 条 gold 为单块文档（Q65/67/68/69/70/71/73/79/81/82/84，正文 128–773 字）。对这 11 条，**文档召回 ⇔ snippet 命中严格合一**——gold 文档唯一的块必然包含 snippet，两级指标退化为一级；snippet 命中率 = 文档召回率，不再提供额外信息。区分度只来自 9 条多块文档（Q66/72/74/75/80/83 为 2–6 块，Q78/77/76 为 15/19/49 块），其中 snippet 锚点 6/9 落在头部块（摘要/TL;DR/标题区，Q76/Q77 最典型）——md 复盘文档"头部元信息块概述全文"的写法，使头部块成为锚点富集区，块级定位难度实际低于块数给人的直觉。**建议评测报告把 md 批次按单块/多块分桶统计**：单块桶只看文档召回，多块桶才看两指标差（块定位能力）；否则 snippet 命中率会被 11 条"天然满分"拉高约一倍虚高。另注意 chunker 的 80 字重叠会使跨块边界的锚点双载（Q78 的 2/15），块命中数≠原文次数，预检脚本应按"≥1 块"判而非计数对比。

**文件名关键词（c 类）的双刃**：8 条 query 与 gold 文件名重合关键词（Q65 位置编码、Q76 校园网/穿透、Q77 EKF-VIO、Q78 hflip、Q82 互联网/清洗、Q74 Spring循环依赖，及 Q79/Q84 两道 exact 书名题）。与 pdf 批次"文件名全要素重合=偏易"的判断不同，md 批次文件名进 chunk 前缀参与 embedding，在派生文档密集的语料里**词法钉反而是对抗孪生的必要手段**（Q77 靠 EKF-VIO 压住阶段二报告、Q80 靠 GRPO 压住 PPO/DPO）——c 类在 md 批次应按"是否同时存在孪生"分别评价：有孪生时是钉子，无孪生时是偏易。

**标注细节遗留**（不影响判定，建议随下轮修订）：①Q79 gold note"功能主句跨行弃用"与 md 源单行事实不符，实际生效机制是避开与操作手册的措辞重叠，应改写（本批无断行问题）；②Q72/Q80 note 里"与 Q3…对照"引用的是已删除的旧 md 批次编号，按当前 gold.json 会误指 pdf 批次的 Q3（Q79 的 note 正确写了"旧md批次已删"，建议统一补注）。
