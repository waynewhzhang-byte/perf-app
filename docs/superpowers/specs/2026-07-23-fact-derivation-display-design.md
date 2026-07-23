# 申报表单事实积分过程展示 — 设计文档

- **日期**: 2026-07-23
- **状态**: 已批准（设计阶段）
- **相关代码**:
  - `src/app/api/facts/route.ts`（API 改造）
  - `src/app/app/submission/[templateId]/page.tsx`（前端展开/折叠）
  - `src/lib/system-filled-items.ts`、`src/lib/performance-score-sheet.ts`（数据来源，只读）
  - `src/lib/fact-derivation.ts`（新增，纯函数）
  - `src/lib/fact-derivation.test.ts`（新增，测试）

## 1. 背景与目标

本系统导入原始台账后，按 11 项评分标准（`SCORING_STANDARDS`）自动生成员工绩效分数。员工在申报表单填写时，需要看到**完整的原始数据和积分过程**，作为可追溯的证明材料。

### 现状

「部门导入事实 · 系统自动计分」区域已展示：
- 最终得分
- 三级事实列表（每条事实一行：角色、缺陷等级、缺陷编号、事件日期、来源文件）

**缺口**：计分引擎 `buildPerformanceScoreSheet` 实际已计算出完整的积分过程（`DimensionScoreRow.lines[].label`、`metadata.breakdown`、`ruleSummary`），但 `/api/facts` 路由在 `extractSystemFilledFromSheet` 中把这些派生信息（`detail`、`sourceFile`、逐步算式）大部分丢弃，只透传 `label` 和 `score`。

### 目标

在申报填报页（`/app/submission/[id]`）的每个系统计分项卡片上，增加**展开/折叠**结构，展开后完整呈现三段式证明材料：
1. **原始台账明细** — 该维度的全部导入事实字段
2. **计分规则** — 该维度使用的规则类型与参数
3. **积分过程** — 从原始分到最终得分的逐步算式

### 范围与约束（用户确认）

| 维度 | 决定 |
|------|------|
| 展示颗粒度 | **全链路**：原始台账 + 规则 + 逐步数字推导 |
| 展示范围 | **仅系统计分项**（8 fact + 2 deduction + 参加工作时间） |
| 展示页面 | **仅填报页**（活引用当前导入事实，不写归档快照） |
| 默认状态 | **默认折叠**（申诉态也不自动展开） |
| 数据隔离 | 每项展开内容只含该维度的事实（按 `sourceDimensionCodes` 过滤） |

### 非目标

- 不改计分引擎逻辑（`computeFactDimensionScore` 等签名不变）
- 不改提交链路、不写 DB schema、不动 `archivedData` 快照语义
- 不影响审核台、历史记录页（仅填报页）
- 不影响员工自行申报项（manual 项）

## 2. 方案选择

评估了三个方案，选定 **方案 A**：

| 方案 | 思路 | 结论 |
|------|------|------|
| **A（选定）** | 扩展 `/api/facts` 透传被丢弃的派生数据，后端组装 `derivation.steps`，前端加展开/折叠 | 改动最小、维度隔离天然成立、活引用当前事实 |
| B | 新增 `/api/facts/[itemId]/derivation` 懒加载接口 | 每次展开一次请求、推导逻辑重复组装、维护两套 |
| C | 把推导明细写入 `SubmissionItem.selected` 持久化快照 | 填报页应反映当前事实；快照引入"数据已变展示未变"歧义；改动 DB schema |

**方案 A 的关键依据**：
- `/api/facts` 已按 `sourceDimensionCodes(code)` 加载并过滤事实 → 数据隔离天然成立
- 计分规则来自纯常量 `SCORING_STANDARD_BY_CODE` + `defaultScoringRuleConfigs()` → 无需新增查询
- 现有字段保持不变，只**新增** `derivation` 字段 → 现有消费方不受影响

## 3. 数据流与 API 改造

### 数据来源

`/api/facts/route.ts` 已加载该用户的 `PerformanceFact` + `EmployeeBasicFact`，并已按 `sourceDimensionCodes(code)` 过滤。本设计**不新增任何 DB 查询**，只重组已有数据。

计分规则来自：
- `SCORING_STANDARD_BY_CODE[code]`（纯常量：`scoringSummary`、`ruleType`、`referenceFile`、`notes`）
- `defaultScoringRuleConfigs()`（纯常量：matrix、ticketPrices、tiers 等参数）

### API 输出

每个 system 计分项的 `item` 增补一个 `derivation` 字段（manual 项无此字段）：

```typescript
item.derivation = {
  ruleType: string,          // 'BASIC_TIER' | 'SHARE' | 'MATRIX_SUM' | 'NORMALIZE' | 'DEDUCTION' | 'MANUAL_TIERS' | 'MANUAL_COUNTED'
  ruleSummary: string,       // 标准摘要（来自 sys.ruleSummary）
  referenceFile?: string,    // 原始台账文件名（来自 SCORING_STANDARD_BY_CODE）
  notes?: string,            // 如"不可与安全贡献重复加分"
  rawFactFields: FactField[],// 该维度每条事实的完整字段（复用现有 facts[]，不再丢弃）
  steps: DerivationStep[],   // 逐步推导，后端组装
}

interface DerivationStep {
  label: string;   // 如"操作票 150 × 0.01 = 1.5"
  detail?: string; // 补充说明，如"四舍五入"
  kind?: 'raw' | 'subtotal' | 'cap' | 'final' | 'note'; // 渲染样式提示
}
```

### 关键约束

- `steps` 在**后端组装**（前端只渲染，不做计算）→ 保证数字与服务器最终得分一致
- `rawFactFields` 直接复用 `/api/facts` 现已返回的 `facts[]`（每条含 role/defectRef/defectLevel/eventDate/sourceFile/metadata）→ 不再丢弃任何字段
- 现有字段（`items[].facts[]`、`scoreSheet`、`totalScore`）保持不变，只新增 `derivation`

### 新增模块

`src/lib/fact-derivation.ts`（纯函数，便于测试）：
- 导出 `buildDerivation(dimensionCode, facts, basicFact, context): Derivation`
- 按 `ruleType` 分派到对应的 steps 组装函数
- `context` 携带 `ticketCohortMax`、`overrideScore` 等运行时参数

## 4. 各维度的展开内容规格

按计分规则类型定义 `steps` 组装逻辑。**触顶时显示「封顶 X」步骤，未触顶则省略**，避免误导。

### 类型 1：BASIC_TIER（技能等级 / 职称等级 / 绩效等级）

- **原始台账**：1 条 `EmployeeBasicFact` → `tierValue`、`yearBreakdown`、`sourceFile`
- **计分规则**：`scoringSummary` + 档位查表（`defaultScoringRuleConfigs` 的 `tiers`）
- **steps 示例（绩效等级）**：
  - `近三年考核：2023→A，2024→B，2025→B → 组合档位 1A2B`（`yearBreakdown` 缺失时跳过此步）
  - `档位 1A2B → 5.0 分`
  - `封顶 6.0`（未触顶省略）

### 类型 2：SHARE（安全贡献）

- **原始台账**：多条 `PerformanceFact`，每条含 `defectRef`、`role`、`score`
- **计分规则**：`scoringSummary` + `roles` 参数（perIncident=3、multiplyByFaultCount、totalShare 均分）
- **steps 示例**：
  - `事件 #缺陷001：第一发现人 3 分/次 × 2 次故障 = 6.0`
  - `事件 #缺陷002：2 名共同发现人 均分 3 分/次 × 1 次故障 = 3.0 ÷ 2 = 1.5`
  - `小计原始分 7.5`（`kind: 'subtotal'`）
  - `封顶 12`（未触顶省略）

### 类型 3：MATRIX_SUM（缺陷治理）

- **原始台账**：多条 `PerformanceFact`，每条含 `defectLevel`、`role`、`defectRef`、`score`
- **计分规则**：`scoringSummary` + 矩阵查表（`config.matrix`）+ `tieBreak: MAX_PER_PERSON`
- **steps 示例**：
  - `缺陷 D001 危急 · 第一发现人 → 矩阵查表 3.0`
  - `缺陷 D001 危急 · 第一处理人 → 矩阵查表 3.0`
  - `同人 D001 兼发现+处理，取高 → 3.0`（仅当命中 tieBreak 时出现）
  - `缺陷 D002 一般 · 第一发现人 → 0.5`
  - `小计原始分 3.5 → 封顶 12`

### 类型 4：NORMALIZE（两票执行）— 两段式

- **原始台账**：1 条聚合事实，`metadata.breakdown` 含各票种数量，`sourceFile`
- **计分规则**：`scoringSummary` + `config`（operationStepPrice=0.01、ticketPrices、targetMaxScore=30）
- **steps 示例**：
  - **第一段（原始分）**：`操作票 150 项 × 0.01 = 1.5`；`总工作票负责人 2 张 × 5 = 10`... → `原始分 18.5`
  - `专业最高原始分 20.0`（`ticketCohortMax`）
  - **第二段（折算）**：`18.5 / 20.0 × 30 = 27.75`
  - `封顶 30`（未触顶省略）
- **breakdown 缺失时**：第一段改为聚合显示 `原始分 X`（来自 fact.score），过程区补注"明细未导入"

### 类型 5：DEDUCTION（严重/一般违章扣分）

- **原始台账**：多条扣分事实，每条含 `defectRef`、`role`、`score`（负值）
- **计分规则**：`scoringSummary`（如"直接责任人-10/次；连带-5/次"）
- **steps 示例**：
  - `违章 Z001 · 直接责任人 → -10.0`
  - `违章 Z002 · 连带责任人 → -5.0`
  - `小计 -15.0`（扣分维度不封顶，直接累加）

### 类型 6：MANUAL_TIERS / MANUAL_COUNTED（技术贡献/竞赛/创新）

这几个维度在导入时由各 lib 模块按自身逻辑算好单条 `score`，引擎不重算。展开只展示"台账明细 + 汇总"：
- **原始台账**：多条事实，每条含细分维度标题（`dimensionTitle`/`sourceDimensionCode`）、`score`
- **steps 示例（技术贡献）**：
  - `教材/题库/课件 × 2 次 × 3 分 = 6.0`
  - `运规编写 × 1 次 × 2 分 = 2.0`
  - `小计 8.0 → 封顶 12`

## 5. 前端展开/折叠交互与 UI 结构

### 组件位置

改造 `src/app/app/submission/[templateId]/page.tsx` 现有的「部门导入事实 · 系统自动计分」区域（约 580-718 行）。**不新建文件**，内联在页面中（遵循 repo「组件内联」约定）。

### 折叠态（默认）

保持现有卡片不变，只在卡片底部加一个展开按钮：

```
┌─────────────────────────────────────────────┐
│ 两票执行                          [确认][申诉]│
│ 一级：工作现场 · 二级：两票执行               │
│ 系统计算得分：27.8 分                         │
│ 三级：两票执行 · 原始分 18.5（专业最高20，折算…）│  ← 现有摘要行保留
│ ─────────────────────────────────────────    │
│        [▾ 展开原始数据与积分过程]             │  ← 新增触发器
└─────────────────────────────────────────────┘
```

### 展开态

在摘要行下方插入一个三段式证明区，顶部带折叠按钮：

```
        [▴ 收起]
┌─ 原始台账明细 ──────────────────────────────┐
│ 操作票 150 项 │ 总工作票负责人 2 张 │ ...     │  ← 来自 metadata.breakdown
│ 来源台账：10-13.两票数据汇总.xlsx            │  ← sourceFile
├─ 计分规则 ──────────────────────────────────┤
│ 操作票0.01分/项；工作票按负责人/许可人/...    │  ← ruleSummary
│ 参考：10-13.两票数据汇总.xlsx (引用文件)      │
├─ 积分过程 ──────────────────────────────────┤
│ ① 操作票 150 × 0.01 = 1.5                    │
│ ② 总工作票负责人 2 × 5 = 10                   │
│   → 原始分 18.5                              │
│ ③ 专业最高原始分 20.0（同专业折算基准）        │
│ ④ 18.5 ÷ 20.0 × 30 = 27.75                   │
│   → 最终得分 27.8 分（四舍五入）              │
└─────────────────────────────────────────────┘
```

### 状态管理

- 新增 `expandedItems: Set<string>`（itemId 集合）于现有 `useState` 旁。点击按钮 toggle。
- 默认空集合 = 全部折叠。
- **申诉态不自动展开**（与"默认折叠"保持一致）。

### 渲染分支

按维度的 `ruleType` 渲染不同的 steps 模板（单档位 / 列表 / 两段式折算 / 扣分）。三个区域（台账/规则/过程）的顺序固定，内容随 ruleType 变化。

### 样式约定（遵循 repo Tailwind 内联）

- 三段式用 `border-t` 分隔的子区块，背景比卡片更浅（`bg-slate-50`）
- steps 用编号圆圈 + 箭头连接，参考现有 `text-xs text-slate-500` 字号
- 展开按钮用现有 `border-slate-300` 系列保持视觉一致

### 性能

`derivation` 数据随 `/api/facts` 一次返回，展开是纯客户端 toggle，无额外请求。11 项全展开也只渲染已有内存数据。

## 6. 边界、错误处理与测试

### 边界情况

**1. 无导入事实的维度（0 分系统项）**
- `derivation.steps` 只含一行 `["暂无导入事实，按 0 分计入"]`（`kind: 'note'`）
- 台账/规则区正常显示（规则仍可参考），过程区提示"无可推导演算"
- 展开按钮仍可点击，让员工看清"为何是 0 分"

**2. 原始数据字段缺失**
- `metadata.breakdown` 缺失 → 两票第一段改为聚合 `原始分 X`（来自 fact.score），补注"明细未导入"
- `sourceFile` 为 null → 台账来源区显示"来源台账：未记录"，不报错
- `yearBreakdown` 缺失（绩效等级）→ 跳过年度组合推算，直接显示"档位 X → Y 分"

**3. overrideScore（申诉成功后的管理员改分）**
- 若 SubmissionItem 存在 `overrideScore`，说明该维度得分已被人工覆盖
- 处理：展开区顶部加一条醒目提示「⚠ 该项得分已由审核员调整为 X 分，以下积分过程为系统原始推算（Y 分），仅供参考」
- steps 仍展示原始推算，不掩盖差异（"证明材料"应有的诚实性）

**4. 参加工作时间项（profile.hire-date）**
- 非 fact/deduction 维度，无计分规则
- **不显示展开按钮**（本就无"积分过程"），保持现有行为

**5. 数字精度**
- 所有 steps 中间值保留原始精度（如 27.75）
- 最终得分用 `round1`（一位小数，27.8），过程区明确标注"四舍五入"

### 测试策略

**后端（`src/lib/*.test.ts`，node:test）**
- **新增 `src/lib/fact-derivation.test.ts`**：纯函数测试推导组装逻辑
  - 覆盖 5 种 ruleType + 无事实 + overrideScore + breakdown 缺失
  - 这是核心，因为 steps 组装是新增的纯逻辑
- **不改动** `scoring-engine.test.ts` / `performance-score-sheet.test.ts`：计分引擎零改动

**前端**
- 无单测框架（repo 约定 UI 改动过 `pnpm lint` + `pnpm build`）
- 手动验证矩阵：5 种 ruleType 各挑一个维度，验证展开内容与 `/api/admin/import/scores` 的批量结果一致（数字对齐）

**回归保护**
- `/api/facts` 现有字段保持不变，只新增 `derivation` 字段 → 现有消费方不受影响
- `buildPerformanceScoreSheet` / `computeFactDimensionScore` 签名不变 → derivation 在路由层组装，不污染计分引擎

## 7. 实施改动清单

| 文件 | 改动 |
|------|------|
| `src/lib/fact-derivation.ts` | **新增**。纯函数 `buildDerivation`，按 ruleType 分派组装 steps |
| `src/lib/fact-derivation.test.ts` | **新增**。覆盖 5 种 ruleType + 边界 |
| `src/app/api/facts/route.ts` | 改造。每个 system item 增加 `derivation` 字段（调用 `buildDerivation`） |
| `src/app/app/submission/[templateId]/page.tsx` | 改造。加 `expandedItems` state + 三段式展开/折叠渲染 |

不触碰：计分引擎、提交链路、DB schema、审核台、历史记录页。
