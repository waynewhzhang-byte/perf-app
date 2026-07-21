# 0004 — 模板发布后结构不可变，仅允许文字修订

**Status:** accepted (2026-06-13)

`FormTemplate.status` 一旦从 `DRAFT` 转为 `PUBLISHED`，禁止修改任何结构性字段
（章节、申报项、分值档次、maxScore、dimensionCode 绑定），只允许文字性 PATCH
（修正错别字、补充说明）。文字修订通过 `optionId` 精确匹配，保留原分值。

原因：生产环境模板发布后已有员工申报落地，改结构会让已存在的 `SubmissionItem` 与模板
不一致（item 被删、分值档变了、dimensionCode 改了导致系统填充项失配）。允许结构调整的
迁移成本远高于"发现错字就发新模板"的工作流。

**显式 no-scope**：表单设计器的"可视化拖拽"在已发布模板上是禁止操作，不在产品路线图上。
