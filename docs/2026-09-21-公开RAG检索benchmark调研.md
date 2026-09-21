# 公开 RAG 检索 Benchmark 调研报告

> 日期：2026-09-21（调研执行）
> 背景：MCP_RAG 已有自建评测脚本（文档集 + gold 标注 → Recall@K/MRR/Precision，见 `2026-09-19-RAG能力测试方案.md`），想了解公开 benchmark 能否替代人工标注。
> 调研方式：子代理 79 次检索，来源以官方 GitHub README、HF 数据卡、arXiv 论文为主；经 hf-mirror 与 GitHub raw 交叉核实，未能核实的已注明。

## 0. 结论速览

- **有现成的**：中文"检索质量 benchmark"（query + 语料 + qrels 三件套，直接算 Recall@K/MRR）以 **C-MTEB 的 8 个检索任务**和原始版 **T2Ranking** 为最佳代表，全部可从 HuggingFace 下载（国内 hf-mirror 镜像可用）。
- **推荐两个**：**T2Retrieval**（passage 平均 ~874 字符，与我们的 500-900 字 chunk 粒度天然匹配）+ **DuRetrieval**（每 query 平均 4.9 个 gold，测多相关文档场景）。
- **接入成本**：转换成我们 gold.json 格式约 50-100 行代码。
- **但要看清边界**（§5 诚实评估）：公开 benchmark 测的是 embedding+检索组件，**测不到我们的解析/切块/scope 隔离**——它的语料是预切好的 passage。业内常规是混合用法。

## 1. 中文检索 benchmark 一览

C-MTEB（SIGIR 2024，arXiv:2309.07597）的 8 个检索任务（全部 s2p 型，主指标 nDCG@10）：

| 任务 | 语料规模 | test query | gold/query | 许可证 |
|---|---|---|---|---|
| **T2Retrieval** | 118,605 | 22,812 | 平均 5.2（0-4 分级） | Apache-2.0 |
| **DuRetrieval** | 100,001 | 2,000 | 平均 4.92（二值） | 未标注 |
| MMarcoRetrieval | 106,813 | 6,980 | 平均 1.07（二值） | 未标注 |
| CmedqaRetrieval | 100,000 | 3,999 | 平均 1.86 | 未标注 |
| Covid/Ecom/Medical/VideoRetrieval | 约 10 万级 | 各 ~1,000 | — | 未标注 |

- **下载要点**：HF 上用 `mteb/*` 组织的版本（含 default(qrels)/corpus/queries 三个子集，parquet 格式），不要用老的 `C-MTEB/*`（qrels 不在数据文件里）。
- **注意**：C-MTEB 各任务语料是"全量采样 10 万候选（含 gold）"的子集，不是原始全量。
- mMARCO（MS MARCO 的机翻中文版）= MMarcoRetrieval 的底料，**机翻有翻译腔**，评分时留意。
- **BEIR 本体没有中文**（19 个数据集全英文）。

## 2. 原始全量版

- **T2Ranking**（THUIR/北交大，SIGIR 2023）：搜狗真实 query，300K+ query、230 万 passage、4 级人工标注；TREC qrels 三件套 tsv 格式；Apache-2.0。**独特价值：附带 passage→document 映射文件**——公开集中少有的能做文档级评分的（与我们文档级口径对齐）。官方 BM25 基线 MRR@10=0.359。
- **DuReader-retrieval**（百度，EMNLP 2022）：90K+ query、800 万+ passage，人工 pooled 标注（压制假阴性）——中文 passage 检索最权威的大规模标准集。

## 3. 检索 vs 生成 benchmark（明确区分）

| 类型 | 代表 | 测什么 | 我们要吗 |
|---|---|---|---|
| 检索质量 | C-MTEB 检索任务、T2Ranking、BEIR | Recall/MRR/nDCG（query+语料+qrels） | ✅ 正是 eval.ts 的口径 |
| 生成质量 | CMRC、RAG_truth、CRAG | EM/F1、忠实度 | ❌ 暂不要 |
| 评测框架 | **RAGAS / TruLens / ARES** | LLM-judge 指标（faithfulness 等） | ⚠️ 是框架不是数据集 |

RAGAS/ARES 有一个对我们真正有用的能力：**从自己的语料合成测试 query**（LLM 生成+人工抽检）——这是自建 gold 集的减负途径，但不能替代客观的 Recall/MRR（LLM judge 有噪声）。

## 4. 工程对接

- 标注格式两种：TREC qrels（tsv，`qid\tpid\tgrade`）与 HF parquet（query-id/corpus-id/score 列）——语义等价，转换都是几十行。
- **粒度问题（关键）**：中文 benchmark 的检索单元几乎都是 **passage 级**。T2Retrieval passage ~874 字符 ≈ 我们的 chunk；但**不是"文档"**——直接用时把 passage 当文档（业内普遍做法），或用 T2Ranking 的 doc 映射聚合（+20 行）。
- **scope 隔离测不到**：公开集都是单库全局检索，无多租户标注——scope 隔离只能靠自建 gold 集（我们已有跨库隔离测试覆盖）。
- 转换代码量：T2Retrieval 约 50-80 行（含 doc 聚合），DuRetrieval 约 30-50 行（passage 级）。

## 5. 诚实评估：公开 benchmark vs 自建 gold 集

**公开集测不到的**（语料是预切好的 passage，跳过我们管线前半段）：
- 文档解析（pdf/xlsx/csv 全链）
- 切块策略（chunker 的所有设计）
- scope 隔离、管理页、整个入库流水线

**公开集能测到的**：
- embedding 模型选型对比（智谱 embedding-3 vs bge-m3 vs 其他——在 T2Retrieval 上跑分）
- 检索实现正确性 sanity check（与社区公开分数对齐，发现实现 bug 的利器）
- LanceDB 参数（topK、索引方式）调优

**业内常规做法是混合**：
1. 公开集子采样（几百-几千 query）做**组件级回归**——嵌入模型选型的一次性决策依据，非常值；
2. 50-200 条自建 gold（可借 RAGAS/ARES 的合成 query 手法从真实文档生成、人工抽检）做**系统级评测**——切块/解析这些自家环节只有它能测；
3. 对几百-几千文档的家用库，纯跑 10 万级公开集的边际收益低。

## 6. 对我们的落地建议

**推荐路线**：两条腿——

- **路线 A（自建，已就绪）**：继续按 `2026-09-19-RAG能力测试方案.md` 用自己的 testdata + gold.json。这是唯一覆盖"解析→切块→检索"全链路的评测，也是 FTS 立项（exact 桶差值）的证据来源。**保持为主基准**。
- **路线 B（公开，按需）**：当要做 **embedding 模型选型**（比如怀疑智谱 embedding-3 质量、想对比 bge-m3）时，拉 `mteb/T2Retrieval` 子采样（500-1000 query + 对应语料），写 50 行转换脚本生成 gold.json 格式，用现有 ingest/eval 跑——passage 直接当 chunk 灌库（旁路解析切块），测的是纯检索组件。**作为选型工具，不作为主基准**。

优先级判断：当前阶段（系统刚跑通、正在建基线）**先走路线 A**；路线 B 等出现"要不要换 embedding 模型"这个具体问题时再启动，那时它最有价值。

## 主要来源

- C-MTEB：github.com/FlagOpen/FlagEmbedding/tree/master/research/C_MTEB + arXiv:2309.07597
- T2Ranking：github.com/THUIR/T2Ranking + arXiv:2304.03679
- DuReader-retrieval：github.com/baidu/DuReader + arXiv:2203.10232
- mMARCO：github.com/unicamp-dl/mMARCO + arXiv:2108.13897
- BEIR：github.com/beir-cellar/beir
- RAGAS/ARES/TruLens：各自 GitHub
- HF 数据卡：mteb/T2Retrieval、mteb/DuRetrieval、mteb/MMarcoRetrieval 等（国内镜像 hf-mirror.com）
- 未找到：名为 "CMNews" 的公开中文检索 benchmark；部分 C-MTEB 任务数据卡未标许可证（使用前自查）
