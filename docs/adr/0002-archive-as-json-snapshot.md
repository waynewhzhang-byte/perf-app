# 0002 — 绩效档案用归档快照而非实时 join

**Status:** accepted (2026-06-13)

L2 终审通过时把 submission + items + attachments + section scores + templateMaxScore
整体序列化为 JSON 写入 `PerformanceRecord.archivedData`，`totalScore` 一并固化。
**不**用提交时实时 join `Submission` / `SubmissionItem` 来呈现历史档案。

原因：模板发布后结构基本 immutable，但代码版本仍会演进（评分规则、维度定义、UI 字段都可能改）。
归档是法律意义上的终态记录，必须保留"那一年的事实"，不能因为后续代码变化而漂移。
快照换来的是不可变性与审计可追溯，代价是冗余存储与 schema 演进时旧快照需兼容读取。

**禁止把快照语义替换为实时 join** —— 这是业务的硬约束，不是优化目标。
