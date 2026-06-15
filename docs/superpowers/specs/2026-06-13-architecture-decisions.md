# 企业员工绩效申报系统 — 架构设计决策记录

> 来源：2026-06-13 grill-me 深度业务分析（30 轮交互），逐层覆盖数据导入 → 模板设计 →
> 员工申报 → 两级审核 → 申诉处理 → 归档 → 导出的全链路决策树。
> P1 缺陷修复方案见 `2026-06-13-l1-review-fix-design.md`。

---

## 一、数据模型核心约束

| # | 约束 | 决策 |
|---|------|------|
| 1 | Submission `[userId, templateId]` unique | 年度申报，一人一份，upsert 覆盖。不存在多版本 |
| 2 | NotifyConfig `id` 恒为 1 | 通知渠道全局单例，最终选择 SMS，邮件仅代码灵活性预留 |
| 3 | UserRole `[userId, role, scopeBranchId]` unique | REVIEWER_L1 限定分公司范围，REVIEWER_L2 无范围限制（总部视角） |
| 4 | PerformanceRecord `[userId, year]` unique | 一人一年一条档案，终态不可变 |

## 二、设计原则

### 原则 1：年度申报，一人一份

员工对同一模板只能有一份 Submission。不需要多版本草稿/已提交/已驳回分离存储。
业务原因：年度绩效申报每年提交一次，无并发版本冲突场景。

### 原则 2：SMS 唯一通知渠道

通知渠道全局单例（`NotifyConfig` id=1），密钥 AES-256-GCM 加密存储。
运行时 `loadConfig()` 解密后路由到 `aliyun-sms.ts` 或 `smtp.ts`。
管理员切换渠道需运维评估（不会实际发生）。
`sendNotice().catch(() => {})` 不阻塞主流程。

### 原则 3：预审软提示，不阻断

`PreReviewRule`（工龄区间 × 申报等级）在提交时运行，不通过不阻断提交，
仅返回 `preReviewWarnings` 前端展示 + 通知附言。
原因：入职时间数据可能不准确，硬阻断会把合法申报挡在门外。人为审核兜底。

### 原则 4：模板发布后不可变

`FormTemplate.status` 状态机：`DRAFT → PUBLISHED → ARCHIVED`。
PUBLISHED 后禁止改结构/分值，仅允许 `PATCH /text` 文字修订（修正错别字）。
原因：生产环境中模板发布后已有人申报，改结构会导致数据不一致。
文字修订通过 `optionId` 精确匹配，保留原分值。

### 原则 5：系统填充项确认/申诉模型

PerformanceFact 导入的数据作为表单中的"系统自动填充项"：
- 员工**确认** → 分数立即锁定，不进入审核链路
- 员工**申诉** → 填写原因 + 上传附件 → 进入 L1→L2 审核链路
- L2 确认申诉有效 → ADMIN 归档前覆盖分数
- L2 驳回申诉 → 维持系统分数

状态存储在 `SubmissionItem.confirmationStatus: 'CONFIRMED' | 'DISPUTED'`。

**分数覆盖审计：** ADMIN 覆盖申诉分数时须记录 `ReviewLog`（level: `ADMIN_OVERRIDE`），
包含 `userId`、`submissionItemId`、覆盖前后的 `oldScore`/`newScore`、`reason`（关联申诉
L2 决策记录）。绩效分数变更必须可追溯。

### 原则 6：dimensionCode 命名约定对齐

模板设计时，`FormItem` 需要绑定 `dimensionCode`（预定义维度码，不可自由输入），
系统根据 `dimensionCode` 将 PerformanceFact 数据匹配到对应表单项。
章节名称对应一级维度，子项名称对应二级维度。
采用方案 C：预定义维度码列表，管理员从列表中选择。

**MVP dimensionCode 枚举：**

| dimensionCode | 维度名称 | 一级分类 | 数据来源 |
|---|---|---|---|
| `worksite.defect-governance` | 缺陷治理 | 工作现场 | 运检部缺陷库 Excel |
| `worksite.ticket-execution` | 两票执行 | 工作现场 | 两票公示汇总 Excel |
| `performance.safety-contribution` | 安全贡献 | 工作业绩 | 安全突出贡献审批单 |

后续按需扩展，枚举值在代码中以常量数组定义，管理员设计模板时从列表选择。

### 原则 7：评分规则引擎可配置

评分规则存储在数据库中，管理员可配置。规则类型：

**矩阵映射型：** `角色 × 缺陷等级 → 固定分数`
```json
{
  "dimensionCode": "worksite.defect-governance",
  "ruleType": "MATRIX",
  "cap": 12,
  "matrix": {
    "危急": { "FIRST_DISCOVERER": 3, "CO_DISCOVERER": 1, "FIRST_HANDLER": 3, "CO_HANDLER": 1 },
    "严重": { "FIRST_DISCOVERER": 1, "CO_DISCOVERER": 0.5, "FIRST_HANDLER": 1, "CO_HANDLER": 0.5 },
    "一般": { "FIRST_DISCOVERER": 0.5, "FIRST_HANDLER": 0.5 }
  },
  "tieBreak": "MAX_PER_PERSON"
}
```

**聚合均分型：** `按事件分组，角色份额 × N处故障`
```json
{
  "dimensionCode": "performance.safety-contribution",
  "ruleType": "SHARE",
  "cap": 12,
  "roles": {
    "FIRST_DISCOVERER": { "perIncident": 3, "multiplyByFaultCount": true },
    "CO_DISCOVERER": { "totalShare": 3, "multiplyByFaultCount": true, "splitAmong": "CO_DISCOVERER" }
  },
  "groupBy": "incidentId"
}
```

**折算归一型：** `原始分 ÷ 能级最高分 × 目标满分`
```json
{
  "dimensionCode": "worksite.ticket-execution",
  "ruleType": "NORMALIZE",
  "targetMaxScore": 30,
  "sourceKey": "原始分",
  "normalizeWithin": "declarationLevel"
}
```

引擎仅服务于系统导入维度（有外部数据源的维度）。

### 原则 8：源文件字段手动映射

各部门源 Excel 格式不统一。管理员按维度独立上传源文件，
上传后系统显示列头，管理员手动选择"这列是员工姓名，这列是角色..."。
映射配置保存，同维度下次自动匹配。

### 原则 9：能级等级工龄实时计算

`declarationLevel` 由系统根据入职时间实时计算：
- 类似 `PreReviewRule` 的工龄区间映射（0-5 年 → 一级，5-8 年 → 二级，8 年以上 → 三级）
- 在员工申报时自动填入 headerFields，员工不可修改

### 原则 10：归档双存（原始数据 + 计算结果）

`PerformanceRecord` 同时存储：
- `totalScore`：归档时计算并固化，支持快速查询/排名
- `archivedData`：完整 JSON 快照（submission + items + attachments + section scores +
  templateMaxScore），供审计追溯

模板发布后基本 immutable，totalScore 不会因代码版本演进漂移。

### 原则 11：审核逐选项（非逐申报项）

审核单位是 `SubmissionOptionReview`（每个申报项每个选中分值的审核记录），
因为每个分值都需要核对事实证据。不是以整个申报项为单位。

L1 逐项 APPROVE/REJECT → L2 总部终审 → 归档。驳回后仅被驳回项可编辑重提。

### 原则 12：L1 审核纯逐项决策（P1 已修复）

原缺陷：`overallAction`（整表驳回）和逐项决策双路径共存，
整表驳回绕过逐项决策导致已审工作丢失。

修复：移除 `overallAction`/`overallNote`，强制 L1 审核员逐项过目逐项决策。
详见 `2026-06-13-l1-review-fix-design.md`。

## 三、完整数据流

```
┌──────────────────────────────────────────────────────────────────┐
│                    年度能级评价 — 全流程                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 模板发布                                                      │
│     ADMIN 设计 FormTemplate（章节 + 申报项 + dimensionCode）     │
│     → PUBLISHED 后不可改结构（仅文字修订）                        │
│                                                                  │
│  2. 事实导入                                                      │
│     ADMIN 上传各部门源 Excel（字段手动映射）                       │
│     → 评分规则引擎计算分数 → PerformanceFact                      │
│                                                                  │
│  3. 员工注册                                                      │
│     输入用户名/工号/手机号 → 匹配预导入员工数据 → 获得 EMPLOYEE    │
│                                                                  │
│  4. 员工申报                                                      │
│     ┌──────────────────────────────────────┐                     │
│     │ 系统填充项 → 确认(锁定) / 申诉(审核)   │                    │
│     │ 手工填写项 → 选分 + 内容 + 附件       │                    │
│     │ 表头字段（工区/入职时间/能级/专业）    │                    │
│     │ 预审（软提示不阻断）                  │                     │
│     └──────────────────────────────────────┘                     │
│     → 提交                                                       │
│                                                                  │
│  5. 两级审核                                                      │
│     L1（分公司）逐项 APPROVE/REJECT                               │
│       → 部分通过 + 部分驳回 → Submission REJECTED                 │
│       → 全部通过 → Submission L1_APPROVED → 创建 L2 审核记录      │
│     L2（总部）按部门逐 option APPROVE/REJECT                      │
│       → 全部通过 → 归档                                          │
│                                                                  │
│  6. 驳回重提                                                      │
│     仅 REJECTED 项可编辑 → 重新提交 → 仅改动项再次审核            │
│                                                                  │
│  7. 申诉处理                                                      │
│     申诉项 → L1 判断合理性 → L2 确认有效                          │
│     → ADMIN 归档前覆盖分数                                        │
│                                                                  │
│  8. 归档                                                          │
│     archivedData (原始) + totalScore (计算) 双存                  │
│     → PerformanceRecord（一人一年一条，终态不可变）                │
│                                                                  │
│  9. 导出                                                          │
│     按分公司 + 年度 → 流式 ZIP                                    │
│     → manifest.csv + archive.json + 附件                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 四、角色体系

| 角色 | 权限范围 | 说明 |
|------|---------|------|
| EMPLOYEE | 本人 | 申报、查看自己档案 |
| REVIEWER_L1 | 限定分公司（`scopeBranchId`） | 一级审核 |
| REVIEWER_L2 | 总部（无分公司限制） | 二级终审 |
| ADMIN | 全局 | 模板设计、组织架构、用户管理、数据导入、导出 |

## 六、性能约束

| 模块 | 约束 | 说明 |
|------|------|------|
| 评分规则引擎 | 批量导入用事务 + 批量查询，禁止逐行 DB 调用 | 缺陷治理 Excel 可达 500+ 行，每条事实需匹配员工+查询规则，逐行调用会超时 |
| 导出 ZIP | 流式 archiver，不落盘 | 已实现，保持现有模式 |
| 员工批量导入 | 批量 upsert，单事务 | 避免逐条 create 的 N+1 |
| 事实导入 UI | 上传后异步处理 + 进度轮询 | 大文件解析不应阻塞 HTTP 响应 |

---

## 五、待实现模块

| 模块 | 依赖 | 说明 | 测试策略 |
|------|------|------|---------|
| Excel 导入 UI | PerformanceFact 模型已完成 | 管理员批量导入员工 + 按维度导入事实数据 | 单元：字段映射解析器；E2E：上传→映射→预览→确认导入完整流程 |
| 评分规则引擎 | 规则配置表设计 | 矩阵映射/聚合均分/折算归一 三种模式 | 单元：每种规则类型 3+ case（含封顶、同人高分计、均分）；集成：端到端 Excel→PerformanceFact 得分验证 |
| 系统填充项确认/申诉 UI | SubmissionItem.confirmationStatus | 混合表单的确认和申诉交互 | E2E：确认锁定、申诉附件上传、驳回后重提保留 |
| 申诉处理流程 | 确认/申诉模型 | L1→L2→ADMIN 覆盖分数 | 单元：状态机转换；集成：审计日志完整性 |
| dimensionCode 绑定 | FormItem 加 dimensionCode 字段 | 模板与 PerformanceFact 数据对齐 | 单元：名称匹配 vs 枚举选择两种模式；集成：模板发布→导入数据→自动填充一致性 |
| 员工批量导入 | User 模型扩展 | 工号/姓名/组织单位/能级专业/工种 | 单元：导入解析 + 能级自动计算；E2E：导入→员工注册认领完整链路 |

## 六、性能约束

| 模块 | 约束 | 说明 |
|------|------|------|
| 评分规则引擎 | 批量导入用事务 + 批量查询，禁止逐行 DB 调用 | 缺陷治理 Excel 可达 500+ 行，每条事实需匹配员工+查询规则，逐行调用会超时 |
| 导出 ZIP | 流式 archiver，不落盘 | 已实现，保持现有模式 |
| 员工批量导入 | 批量 upsert，单事务 | 避免逐条 create 的 N+1 |
| 事实导入 UI | 上传后异步处理 + 进度轮询 | 大文件解析不应阻塞 HTTP 响应 |

## 七、NOT in Scope

| 项目 | 原因 |
|------|------|
| 邮件通知渠道 | 最终选择 SMS，邮件仅代码预留 |
| 整表驳回（overallAction） | P1 已修复，见 `2026-06-13-l1-review-fix-design.md` |
| L1 审核草稿暂存 | 审核过程不需要草稿持久化，未提交则重新开始 |
| 移动端 UI 适配 | 当前仅桌面端 |
| 国际化 (i18n) | 当前仅 zh-CN |
| 可视化拖拽表单设计器 | 当前为表单字段编辑模式 |
| PerformanceFact 自动定时导入 | 当前为管理员手动上传 |
| 仪表盘/统计面板 | 后续迭代 |

## 八、What Already Exists

| 能力 | 位置 | 复用策略 |
|------|------|---------|
| 申报 CRUD + 提交状态机 | `src/app/api/submissions/route.ts` | 确认/申诉流程在此基础上扩展 SubmissionItem |
| 审核批量决策 + 事务 | `src/app/api/review/route.ts` | 申诉审核复用现有 L1/L2 审核链路 |
| 归档双存 | `review/route.ts:archiveSubmission()` | 新增申诉覆盖分数后走同一归档路径 |
| 附件上传 (MinIO) | `src/app/api/attachments/route.ts` | 申诉佐证附件复用 |
| 预审规则引擎 | `src/lib/pre-review.ts` | 评分规则引擎参考同模式（可配置规则 + 评估函数） |
| PerformanceFact 模型 | `prisma/schema.prisma` | 事实导入 UI 直接写入现有表 |
| 流式 ZIP 导出 | `src/lib/export-zip.ts` | 保持不变 |
| 认证守卫 | `src/lib/auth.ts:requireRole()` | 所有新 API 入口复用 |

## 九、失败模式

| 流程 | 失败场景 | 测试覆盖 | 错误处理 | 用户可见 |
|------|---------|---------|---------|---------|
| Excel 导入 | 源文件格式与映射配置不匹配 | ❌ 无 | ❌ 未实现 | 上传后报错，需提示具体不匹配的列 |
| 评分引擎 | 同人既是发现人又是处理人，高分计逻辑错误 | ❌ 无 | ❌ 未实现 | 分数偏高，审核环节可能发现 |
| 确认/申诉 | 员工申诉后 L2 驳回，但系统分数被误覆盖 | ❌ 无 | ❌ 未实现 | 员工分数不正确，需审计追溯 |
| ADMIN 覆盖分数 | 覆盖操作未记录，事后无法追溯 | ❌ 无 | 已加入审计要求 (原则 5) | 变更可追溯 |
| 驳回重提 | 锁定项误解锁，员工修改了已通过项 | ✅ 已有 | ✅ 已实现 (`lockedItemIds`) | 已覆盖 |
