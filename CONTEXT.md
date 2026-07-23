# 企业员工绩效申报（perf-app）

国网山西超高压变电公司**年度能级评价**系统：员工自助申报绩效事实，两级审核
（分公司 L1 + 总部 L2），归档形成年度绩效档案。本文是该上下文的**术语表**——
只定义概念是什么，不复述技术栈、命令或实现细节（那些在 `CLAUDE.md` / `GEMINI.md`）。

## 评价流程

**能级评价（Annual Performance Evaluation）**:
公司每年一次的员工能力量化评分，依据《年度能级评价量化积分表》。
_Avoid_: 绩效考核（口语化、含义更宽）

**申报（Declaration / Submission）**:
员工对一份申报模板的填写与提交，是一年一次的产物；同一员工同一模板只有一份。
服务端入口 module 为 `declaration-workflow`（`upsertDeclaration`），与审核工作流
（`review-workflow` / `applyL1`·`applyL2`）对称：Route 开事务传入 `tx`，通知在事务外发送。
填报页预览分与工龄分别复用 `submission-score.computeItemScore` /
`pre-review.calculateFullWorkYears`（与服务端同源），不在页面内联第二套算法。
_Avoid_: 报名、报名表、申请

**申报模板（Form Template）**:
某年度能级评价的章节 + 申报项 + 分值档次的定义，状态机 `DRAFT → PUBLISHED → ARCHIVED`。
发布后结构不可变。详见 ADR-0004。
_Avoid_: 表单（form 过于宽泛）、问卷

**申报项（Form Item）**:
模板章节内一个可评分条目；可手工填写（员工选档次）或系统填充（绑定 dimensionCode）。
_Avoid_: 题目、字段

**维度（Dimension）**:
能级评价量化积分表中的一级/二级评价指标。一级 4 类（基本素质 / 工作业绩 / 工作现场 / 一票否决），
二级 17 个，用 dotted code 标识（如 `worksite.defect-governance`）。权威清单见
`src/lib/scoring-standards.ts` 的 `SCORING_STANDARDS`。详见 ADR-0007。
_Avoid_: 指标项、考核项

## 事实与计分

**绩效事实（Performance Fact）**:
由 ADMIN 从部门源 Excel 导入、由评分规则引擎计算得分的客观绩效事件记录
（缺陷治理、两票执行、安全贡献等）。模型 `PerformanceFact`。
_Avoid_: 数据、记录（过于宽泛）

**基本素质事实（Basic Fact）**:
来自员工档案的档位型事实（技能等级、职称等级、绩效等级），无角色/事件概念。
按年度 + 维度记录档位值与得分。模型 `EmployeeBasicFact`。
与 PerformanceFact **并列**，不可混用——后者是事件型，前者是档位型。
_Avoid_: 基本数据、档案分

**申报维度事实（Submission Dimension Fact）**:
员工手工填写 + L2 审核通过后落库的申报档位/次数事实（manual / deduction 维度）。
L2 归档时由 `SubmissionItem` 写入 `SubmissionDimensionFact`，供绩效分表与年度查询。
模型 `SubmissionDimensionFact`。与上面两类事实并列——三套事实来源不同、写入时机不同。
_Avoid_: 申报数据（与"申报"本身混淆）

**评分规则引擎（Scoring Rule Engine）**:
对导入事实按 `ScoringRule` 配置（`MATRIX` / `SHARE` / `NORMALIZE` / `BASIC_TIER`）
计算得分的纯函数模块（`src/lib/scoring-engine.ts`）。规则存 DB 可配置，但仅服务系统导入维度。
缺陷治理（`worksite.defect-governance`）计分只走引擎 MATRIX：分组键为
`employeeNo|defectRef|defectLevel`（每缺陷独立计分；同缺陷兼岗取高）。
`defect-governance` 模块只负责问题清单 Excel 解析与姓名分拆，不再内嵌矩阵计分。
_Avoid_: 在导入 adapter 里再写一套角色×等级查分

**评分标准（Scoring Standard）**:
《年度能级评价量化积分表》的权威映射：每个维度的满分、数据来源
（`fact` / `manual` / `deduction`）、规则类型、归属部门。`SCORING_STANDARDS` 是单一事实源；
章节树、查询 helper、导入维度快捷常量均在同模块（`scoring-standards.ts`）派生。
_Avoid_: 在第二份 registry / dimension-codes 文件里硬编码维度列表


**维度聚合（Dimension Aggregation）**:
对已计分的绩效事实与基本素质事实，按维度求和、按评分标准封顶、按策略做两票归一化，
得到每人各维度总分。位于评分规则引擎（导入计分）之后、绩效分表展示 / 年度量化报表导出之前。
权威入口为 `aggregateEmployeeDimensions`；绩效分表对 `dataSource=fact` 的导入维度得分
读自该聚合（明细行仍由分表生成），年度量化报表直接消费同一 totals。
两票归一化的 cohort（申报能级 vs 岗位专业）由调用方显式指定，不是第二套封顶表。
_Avoid_: 二次计分、报表引擎、分表引擎

## 角色

**员工（Employee）**:
申报人。`EMPLOYEE` 角色只能查看/编辑自己的申报。

**一级审核员（Reviewer L1）**:
分公司级审核员，`scopeBranchId` 限定可见范围，对申报项逐项 APPROVE/REJECT。
_Avoid_: 初审员

**二级审核员（Reviewer L2）**:
总部终审员，无分公司范围限制，对 L1_APPROVED 的申报做最终审核。
_Avoid_: 终审员（口语化）

**管理员（Admin）**:
全局角色：模板设计、组织架构、用户管理、数据导入、导出。

## 组织架构

**分公司（Branch）**:
组织的二级单位（运维分部、检修中心、特高压站等）。L1 审核员范围以此为单位。
_Avoid_: 单位、子公司、工区（口语化）

**总部（Headquarters / HQ）**:
公司总部，`Branch.name = '公司总部'`（`org-mapping.ts:HQ_BRANCH_NAME`）。
总部员工挂在总部 Branch 下的 Department；L2 审核员与总部部门绑定。
_Avoid_: 总公司、机关

**班组（Team）**:
分公司 Department 下的最小组织单元（如某变电运维班）。模型 `Team`。

## 审核与申诉

**审核工作流（Review Workflow）**:
一级/二级审核员对一份申报从接收到终态的完整过程：逐选项审核（含系统填充项申诉判断）、
状态推进，直至整单驳回，或全部通过后写入归档快照与绩效档案（并落申报维度事实）。
_Avoid_: 审批流（OA 用语）、审核服务

**系统填充项（System-Filled Item）**:
`FormItem` 绑定了 `dimensionCode`、值来自导入事实的申报项，员工不可改分值。
员工可选 **确认（CONFIRMED）** 锁定，或 **申诉（DISPUTED）** 进入审核链路。

**逐选项审核（Option-Level Review）**:
审核单位是 `SubmissionOptionReview`——每个申报项每个选中分值一条审核记录，
而非整申报项。因为每个分值都需要核对事实证据。详见 ADR-0005。
_Avoid_: 整项审核、批量审核

**预审（Pre-Review）**:
`AutoReviewRule`（工龄区间 × 申报等级）在提交时运行，不通过**不阻断**提交，
只返回 `preReviewWarnings` 前端展示 + 通知附言。详见 ADR-0006。
_Avoid_: 强校验、资格校验

**驳回重提（Reject & Resubmit）**:
任一级别有项被驳回 → 整申报 `REJECTED` 退回员工 → 仅 REJECTED 项可编辑重提，
其余项锁定 → 重提后仅改动项再次审核。

## 归档与导出

**绩效档案（Performance Record）**:
一人一年一条的终态记录（`[userId, year]` unique）。同时存储 `totalScore`（计算结果）
和 `archivedData`（完整 JSON 快照）。详见 ADR-0002。
_Avoid_: 档案（过于宽泛）、考评结果

**归档快照（Archived Snapshot）**:
`PerformanceRecord.archivedData` —— L2 全部通过时写入的 submission + items + attachments +
section scores + templateMaxScore 的完整 JSON 副本。拼装入口为纯函数
`buildArchivedSnapshot`（`finalizedAt` 注入）；`finalizeArchive` 负责落库编排
（submission → PerformanceRecord → SubmissionDimensionFact），仍只由 applyL1/L2 调用。
模板发布后基本 immutable，快照不随代码版本漂移。**不要替换快照语义为实时 join**（见 ADR-0002）。

**申报表头字段（Declaration Header Fields）**:
提交时刻固化的员工信息快照（工区、入职时间、申报等级、申报专业、工龄）。
是申报时点的状态副本，不随后续组织/工龄变化更新。

## 数据源与导入

**事实导入（Fact Import）**:
ADMIN 上传各部门源 Excel → 手动字段映射 → 评分规则引擎计分 → 写入事实表。
`FactImportLog` 记录每次导入的源文件、汇总、未匹配项。

**字段映射（Field Mapping）**:
各部门 Excel 列头不统一；管理员在导入预览中手动选择"这列是员工姓名、这列是角色..."。
映射配置按维度保存，下次同维度上传自动匹配。

## 单例配置

**通知渠道（Notify Channel）**:
全局单例 `NotifyConfig`（`id=1`）：SMS（阿里云短信）或 EMAIL（SMTP）。生产环境最终选择 SMS，
EMAIL 仅作代码灵活性预留。详见 ADR-0001。密钥 AES-256-GCM 加密存库。

**认证策略（Auth Config）**:
全局单例 `AuthConfig`（`id=1`）：注册/登录/找回是否需要验证码、是否启用强密码策略。
管理员后台切换实时生效。
