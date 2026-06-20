# 统一手工导入体系设计（替代一键流水线）

- 日期：2026-06-21
- 状态：待实现
- 关联：`src/app/admin/import/`、`src/lib/import-pipeline.ts`、`prisma/schema.prisma`

## 1. 背景与目标

### 现状问题
当前系统存在两套并行且割裂的导入入口：

1. **一键流水线** `/admin/import`（"执行导入"tab）：从服务器固定路径读取文件名（`《基本素质信息》.xlsx` 等），靠**硬编码列号**（`SHEET1_COLUMNS.employeeNo`）解析，用户无法干预字段映射。一个按钮跑全部 4 步。
2. **单维度手工导入** `/admin/import/legacy`：浏览器上传文件，前端解析 CSV/XLSX，**UI 手动映射**列头 → 系统字段。但只能写 `PerformanceFact`（缺陷/两票/安全事件事实），写不了员工档案与基本素质事实。

核心矛盾：用户想要的"上传 + 手动对应字段"能力，legacy 已有雏形，但覆盖面不足。

### 目标
**用统一的、卡片导航的手工导入体系，完全替代一键流水线**，使管理员能对每类数据（员工档案 + 各评分项事实）选择性上传、自行对应字段。一键流水线的 UI 触发入口下线，但其库函数保留（CLI 脚本仍在用）。

### 非目标
- 不重写评分计分逻辑——全部复用 DB `ScoringRule` + `computeFactScores`。
- 不改 overview / scores 查询 API。
- 不删除 `runImportPipeline` 库函数（CLI 脚本 `scripts/import-facts-pipeline.ts` 依赖）。

## 2. 整体架构

`/admin/import` 变成**导入中心首页（卡片墙）**，不再有一键按钮。5 个导入项卡片，每张卡 = 一个独立子页 + 独立 API，按依赖顺序排列：

| # | 导入项 | 写入目标 | 依赖 |
|---|---|---|---|
| ① | 员工档案与组织架构 | `User` / `Branch` / `Department` / `Team` / `Position` | 无（最先做，建立名册） |
| ② | 基本素质三维度 | `EmployeeBasicFact`（技能/职称/绩效） | 依赖 ① 名册 |
| ③ | 两票执行 | `PerformanceFact`(ticket) | 依赖 ① |
| ④ | 缺陷治理 | `PerformanceFact`(defect) | 依赖 ① |
| ⑤ | 安全贡献 | `PerformanceFact`(safety) | 依赖 ① |

每个子页是**同一个四步表单组件**的不同配置：上传文件 → 自动/手动映射列 → 预览（含分数试算）→ 导入。

## 3. 统一四步导入表单组件（ImportWizard）

5 个子页共享一个 `<ImportWizard>` 组件，靠配置差异化。

### 四步流程（单页内纵向展开，非弹窗）

1. **上传**：拖拽/选择 CSV/XLSX/XLS → 前端用共享 `parseCSV`/`parseXLSX` 解析 → 显示行数。
2. **字段映射**：列出该导入项的系统字段（每个带中文 label），右侧下拉选文件列头。沿用 legacy 的"按中文名自动模糊匹配"逻辑。必填项（如工号/姓名）未映射时禁用导入并标红。
3. **预览**：前 20 行表格（映射后的标准化字段，非原始列）+ **分数试算列**（调用 `/api/admin/import/preview` 对预览行算分，让用户在导入前看到结果）。组织/档案类无分数则显示"将新建/将更新"状态。
4. **导入**：POST 到对应写入 API，返回 新建/更新/跳过 计数 + 未匹配姓名列表。

### 配置驱动

```ts
interface ImportItemConfig {
  code: 'employees' | 'basic' | 'tickets' | 'defects' | 'safety';
  title: string;
  description: string;
  dependsOn: string;        // 提示"依赖员工档案"
  fields: FieldSpec[];
  apiEndpoint: string;      // POST 目标
  requireFullBatch?: boolean; // 两票=true：必须一次传完整年度
  hasScorePreview: boolean; // 员工档案=false
}
interface FieldSpec {
  key: string;        // 'employeeNo'
  label: string;      // '工号'
  required: boolean;
  hint?: string;      // '姓名匹配以员工档案名册为准'
}
```

### 共享前端代码
legacy 页的 `parseCSV`/`parseXLSX`、映射 UI、预览表格样式抽到 `src/app/admin/import/_shared/`，legacy 页删除后这些代码不浪费。

## 4. 三层组织架构（数据模型变更）

### 背景
现有 schema 是两层：`Branch`（二级单位/总部）→ `Department`（班组/处室）。业务实际需要三层：**工区 → 部门 → 班组**。现有 `org-mapping.ts` 用 `BRANCH_PATTERNS` 正则硬猜哪个"部门"是工区，逻辑不透明且无法承载真三层。

### 数据模型变更（新增迁移）

```
Branch(工区)  →  Department(部门)  →  Team(班组)   [新增表]
  - 含"公司总部"工区                    - 挂在 Department 下
```

- 新增 `Team` 模型：`id / departmentId / name / createdAt`，挂在 `Department` 下。
- `User` 增加 `teamId String?` 外键 → `Team`。
- 现有数据迁移：现有 `Department` 保持为"部门"层，班组层暂空（待重新导入填充）。**不动 Department 既有数据**。
- `org-mapping.ts` 的 `parseOrgFromExcelRow` / `BRANCH_PATTERNS` 废弃（新逻辑直接用映射列），暂不删除以免动 CLI。

## 5. 各导入项字段映射与写入逻辑

### 卡片 ① 员工档案与组织架构

| 系统字段 | 必填 | 写入 | 说明 |
|---|---|---|---|
| 工号 | ✅ | `User.employeeNo` | |
| 姓名 | ✅ | `User.fullName` | |
| 工区 | ✅ | `Branch`（缺则建） | 含总部及各工区 |
| 部门 | ✅ | `Department`（挂在工区下，缺则建） | |
| 班组 | ❌ | `Team`（挂在部门下，缺则建） | 可空 |
| 岗位 | ❌ | `Position`（缺则建） | |
| 性别 | ❌ | `User.gender` | |

- 用户选列名对应系统字段，**不再有 `*** / ****` 拆字符串**——工区/部门/班组各对应一列。
- 自动建组织：按 工区→部门→班组 顺序 ensure，沿用 `ensureOrgStructure` 思路扩展到三层。
- `profile` JSON 仍存其余未单独建表的原始列。
- **无分数**（档案类）。

### 卡片 ② 基本素质三维度（独立项）

| 系统字段 | 必填 | 写入 |
|---|---|---|
| 工号 | ✅ | `EmployeeBasicFact.employeeNo` |
| 姓名 | ❌ | `EmployeeBasicFact.employeeName` |
| 技能等级 | ❌ | 技能档位值 |
| 职称等级 | ❌ | 职称档位值 |
| 绩效2023 | ❌ | 三年 A/B 之一 |
| 绩效2024 | ❌ | 三年 A/B 之一 |
| 绩效2025 | ❌ | 三年 A/B 之一 |

- 一次上传算出**三条** `EmployeeBasicFact`（技能/职称/绩效）。
- 技能/职称：`BASIC_TIER` 查表（档位值→分）。
- 绩效：三年 A/B 组合 → 组合码（如 `2A1B`）→ 查表，`yearBreakdown` 存三年明细。
- 写 `EmployeeBasicFact`（upsert by year+employeeNo+dimension）——legacy 从未支持此表，需新增写入路径。
- 试算：每行显示三个维度得分。

### 卡片 ③ 两票执行

| 系统字段 | 必填 | 写入 |
|---|---|---|
| 工号 | ✅ | `PerformanceFact.employeeNo` |
| 姓名 | ❌ | |
| 原始分 | ✅ | `rawScore` |
| 能级 | ✅ | `declarationLevel` |
| 事件日期 | ❌ | `eventDate` |

- ⚠️ `requireFullBatch: true`——`NORMALIZE` 折算要按能级找整批最高分，**必须一次传完整年度数据**。UI 提示"请上传全部人员数据，分批会导致折算错误"。
- 写 `PerformanceFact`（dimensionCode=`worksite.ticket-execution`，每人一条聚合）。

### 卡片 ④ 缺陷治理

| 系统字段 | 必填 | 写入 |
|---|---|---|
| 工号 | ✅ | |
| 姓名 | ❌ | |
| 角色 | ❌ | `role` |
| 事件类型 | ❌ | `eventType` |
| 缺陷等级 | ❌ | `defectLevel` |
| 缺陷编号 | ❌ | `defectRef` |
| 事件日期 | ❌ | `eventDate` |

- `MATRIX_SUM`，复用 legacy 现有逻辑（含多人拆分、合作标记、同人兼任取高）。
- 写 `PerformanceFact`（`worksite.defect-governance`）。

### 卡片 ⑤ 安全贡献

| 系统字段 | 必填 | 写入 |
|---|---|---|
| 工号 | ✅ | |
| 姓名 | ❌ | |
| 角色 | ❌ | `role` |
| 故障次数 | ❌ | `faultCount` |
| 事件编号 | ❌ | `incidentId` |
| 事件日期 | ❌ | `eventDate` |

- `SHARE` 均分，按 incidentId 分组。
- 写 `PerformanceFact`（`performance.safety-contribution`）。

### 统一约束
③④⑤ 写 `PerformanceFact` 前按 employeeNo 匹配名册 `User`（找不到 → userId=null 但仍写入 + 进未匹配列表），与现状一致。

## 6. API 设计

### 统一请求体（所有写入端点共用）

```ts
{
  year: number;
  sourceFile: string;
  mapping: Record<string, string>;  // 系统字段key → 列头名
  rows: Record<string, string>[];
  dryRun?: boolean;
}
```

### 统一响应体

```ts
{
  success: true;
  total: number; created: number; updated: number; skipped: number;
  unmatched?: { name: string; reason: string }[];  // ③④⑤ 名册未匹配
}
```

**dryRun 语义**：写入端点 `dryRun=true` 时同样返回上述响应体（counts 为试算结果，不写库），用于"导入前最终确认"。它与独立的 `/preview` 端点分工不同——`/preview` 服务于映射阶段的**实时逐行试算**（不校验、不计数），写入端点的 `dryRun` 服务于导入前的**全量计数确认**。前端预览步用 `/preview`，导入按钮长按/二次确认可用 `dryRun`（可选增强，MVP 可只实现 `/preview`）。

### 端点清单

| 端点 | 写入 | 评分 | 特殊 |
|---|---|---|---|
| `POST /api/admin/import/employees` | `User`+三层组织+`Position` | 无 | 自动建工区/部门/班组 |
| `POST /api/admin/import/basic` | `EmployeeBasicFact` ×3 | `BASIC_TIER` 查表 | 一行出三条事实 |
| `POST /api/admin/import/tickets` | `PerformanceFact` | `NORMALIZE` | 要求完整年度批次 |
| `POST /api/admin/import/defects` | `PerformanceFact` | `MATRIX_SUM` | 复用 legacy 逻辑 |
| `POST /api/admin/import/safety` | `PerformanceFact` | `SHARE` | 复用 legacy 逻辑 |
| `POST /api/admin/import/preview` | 无 | 各项 | 试算分发，不写库 |

`preview` body 含 `itemCode` + `mapping` + `rows`，内部按 itemCode 分发到对应评分函数（全部复用现有引擎）。员工档案类返回"将新建/将更新"状态而非分数。

鉴权：全部沿用 `requireAdmin()`。

## 7. 文件结构

### 前端

```
src/app/admin/import/
├─ page.tsx                      [改造] 导入中心首页 = 卡片墙
├─ _shared/
│  ├─ parse.ts                   [新] 从 legacy 抽出的 parseCSV/parseXLSX
│  ├─ ImportWizard.tsx           [新] 统一四步表单组件
│  ├─ field-specs.ts             [新] 5 个导入项的 FieldSpec 配置
│  └─ types.ts                   [新] ImportItemConfig / FieldSpec
├─ employees/page.tsx            [新] 卡片①
├─ basic/page.tsx                [新] 卡片②
├─ tickets/page.tsx              [新] 卡片③
├─ defects/page.tsx              [新] 卡片④
├─ safety/page.tsx               [新] 卡片⑤
└─ legacy/page.tsx               [删除]
```

每个子页极薄——只引入 `<ImportWizard config={...} />`。

### 首页改造
- 删除现有 4 个 tab（执行导入/导入数据/绩效分表/未匹配）和一键按钮。
- 改为卡片墙：5 张导入项卡（编号①–⑤，标注依赖"需先导入员工档案"）。
- 底部保留"按维度查看导入结果"入口（链到 overview/scores 查询）。

### 后端

```
src/app/api/admin/import/
├─ employees/route.ts            [新]
├─ basic/route.ts                [新]
├─ tickets/route.ts              [新]
├─ defects/route.ts              [新]
├─ safety/route.ts               [新]
├─ preview/route.ts              [新]
├─ overview/route.ts             [保留]
├─ scores/route.ts               [保留]
├─ scores/export/...             [保留]
├─ route.ts                      [删除](legacy)
└─ pipeline/route.ts             [保留代码，UI 不再触发]
```

### 库函数
- **复用不动**：`computeFactScores`、`defect-governance.ts`、`safety-contribution.ts`、`ticket-execution-import.ts` 核心计分。
- **新增**：`employee-import.ts`（三层组织 ensure + User upsert，从 `basic-quality-import.ts` 剥离档案部分）、`basic-fact-import.ts`（写 `EmployeeBasicFact`，BASIC_TIER 查表）。
- **保留但隔离**：`runImportPipeline`（仅 CLI 脚本调用）。

## 8. 数据库迁移

- 新增 `prisma/migrations/<ts>_add_team/`：建 `Team` 表 + `User.teamId` 外键。
- `Team` schema：
  ```prisma
  model Team {
    id           String   @id @default(cuid())
    departmentId String
    name         String
    createdAt    DateTime @default(now())
    department   Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)
    users        User[]
    @@unique([departmentId, name])
  }
  ```
- `User` 加 `teamId String?` + `team Team? @relation(fields: [teamId], references: [id])`。
- 现有数据：Department 保持为"部门"层，班组层留空待导入。

## 9. 测试

- **复用**：现有 `*.test.ts`（scoring-engine / defect / safety / ticket 的计分测试）——逻辑不动，自然仍绿。
- **新增**：
  - `employee-import.test.ts`：三层 ensure + 自动建组织。
  - `basic-fact-import.test.ts`：三年绩效组合码（如 `[A,B,B] → 2A1B → 5`）。
  - preview 端点试算分发测试（各 itemCode 路由正确、员工档案返回状态而非分数）。

## 10. 实施顺序（建议）

1. 数据库迁移（`Team` 表 + `User.teamId`）。
2. 库函数：`employee-import.ts` + `basic-fact-import.ts` + 测试。
3. 后端 6 个 API 端点 + 测试。
4. 前端 `_shared`（types/parse/ImportWizard/field-specs）。
5. 前端 5 个子页 + 首页卡片墙改造。
6. 删除 legacy 页与 `/api/admin/import/route.ts`，下线 pipeline UI 触发。
7. 全链路验收（导入中心 → 各卡片 → 预览试算 → 导入 → overview 查询）。

## 11. 风险与权衡

- **两票 NORMALIZE 必须整批**：无法绕过，靠 UI 强提示 + `requireFullBatch` flag 约束，而非技术强制（仍允许上传，只是提示后果）。
- **CLI 脚本与 UI 解耦**：`runImportPipeline` 保留意味着两套导入逻辑短期并存；长期若 CLI 也迁到新端点可再清理。
- **现有 Department 数据语义**：迁移不洗数据，旧 Department 当"部门"层用；若历史数据里混入了"班组"名，需管理员重新导入员工档案时归位——属一次性人工校正，不在自动化范围。
