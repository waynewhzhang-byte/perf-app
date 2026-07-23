# 0007 — dimensionCode 作为模板/事实/审核三方的绑定键

**Status:** accepted (2026-06-13)

模板设计时 `FormItem.dimensionCode` 必须从预定义维度码列表中选择（dotted code 如
`worksite.defect-governance`），**不**允许自由文本。系统靠 dimensionCode 把导入事实匹配到
表单项、把审核路由到对应总部部门（`DimensionReviewRoute`）、把得分写回绩效分表。

原因：自由文本会让"模板里的'缺陷治理'和事实表里的'缺陷治理'到底是不是一个东西"变成
人肉对齐问题，跨年度跨模板复用时必崩。预定义维度码强行收口为一一映射，三套数据
（事实、模板、审核）共享一个 vocabulary。

权威维度清单在 `src/lib/scoring-standards.ts` 的 `SCORING_STANDARDS` 数组中。
章节树、查询 helper、导入维度快捷常量均在同模块派生——
若要新增维度，改 `SCORING_STANDARDS` 一处，不要另建 registry / dimension-codes。

**显式 no-scope**：不允许在运行时由管理员新增 dimensionCode——维度定义本身是
《年度能级评价量化积分表》的产物，需要随管理办法更新走代码发布，不走 DB 配置。
