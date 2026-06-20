# 计分规则统一进 DB — 设计文档

> 来源：2026-06-19 brainstorming（导入流水线 + 评分引擎子系统深度剖析）。
> 相关：`docs/2025年能级评价量化积分表.md`（分值权威）、`docs/superpowers/specs/2026-06-13-architecture-decisions.md`（原则 7）。

---

## 一、目标终态

4 个系统导入维度（基本素质、两票执行、缺陷治理、安全贡献）的计分规则，全部存 `ScoringRule` 表（已存在），管理员在 `/admin/scoring` 页面改分值无需改代码。解析器与计分彻底分层：

```
解析器层（纯结构化提取，无计分参数）        计分引擎层（读 DB 规则算分）
┌─────────────────────────────┐         ┌──────────────────────────┐
│ parseSafetyContribution     │ ──facts──▶ scoreWithRule(SHARE)    │
│ parseDefectGovernance       │ ──facts──▶ scoreWithRule(MATRIX)   │
│ parseTicketExecution        │ ──facts──▶ scoreWithRule(NORMALIZE)│
│ parseBasicQuality           │ ──facts──▶ scoreWithRule(BASIC_TIER)│
└─────────────────────────────┘         └──────────────────────────┘
        各自独立、贴合各表结构                    统一入口、参数来自 DB
```

## 二、三个已确认的决策

1. **格式标准**：安全贡献以 `2024年突出贡献奖明细表.xlsx` 的 `申报奖励明细` sheet 为准（11 列）。现有 `safety-contribution.ts` 解析器实测完全适配。
2. **系统导入维度**：`performance.safety-contribution` 的 `dataSource` 从 `'manual'` 改为 `'fact'`，员工只确认/申诉不自填。
3. **单位过滤**：安全贡献不做单位过滤，全量导入；人员匹配走工号（col[5] 员工编号）而非姓名。
4. **规则范围**：4 个维度的计分规则全部进 DB（不只 safety）。
5. **两票单价**：方案 A——操作票单价 + 工作票票种×角色单价表全进 config JSON。
6. **解析器复用**：安全贡献复用现有 `safety-contribution.ts`（拆 parse/score），不重写。

## 三、4 种 ruleType 的 config JSON schema

### BASIC_TIER（基本素质：技能/职称/绩效）

档位值 → 分数查找表。三个 basic 维度各一条 ScoringRule，区别只在 `tiers` 内容。

```json
// basic.skill-level
{ "tiers": { "高级技师": 4, "技师": 3, "高级工": 2, "中级工": 1 }, "defaultScore": 1 }
// basic.title-level
{ "tiers": { "正高级": 4, "副高级": 4, "中级": 3, "初级": 2 }, "defaultScore": 0 }
// basic.performance-level
{ "tiers": { "3A": 6, "2A1B": 5.5, "1A2B": 5, "3B": 4.5 }, "defaultScore": 4 }
```

分层边界：解析器把原始数据归一成档位/组合码（如「技师」「2A1B」），引擎只做 `tiers[code] ?? defaultScore` 查表。

### MATRIX（缺陷治理）— 已存在，原样用

```json
{
  "matrix": {
    "危急": { "FIRST_DISCOVERER": 3, "CO_DISCOVERER": 1, "FIRST_HANDLER": 3, "CO_HANDLER": 1 },
    "严重": { "FIRST_DISCOVERER": 1, "CO_DISCOVERER": 0.5, "FIRST_HANDLER": 1, "CO_HANDLER": 0.5 },
    "一般": { "FIRST_DISCOVERER": 0.5, "FIRST_HANDLER": 0.5 }
  },
  "tieBreak": "MAX_PER_PERSON"
}
```

### SHARE（安全贡献）— 已存在，原样用

```json
{
  "roles": {
    "FIRST_DISCOVERER": { "perIncident": 3, "multiplyByFaultCount": true },
    "CO_DISCOVERER": { "totalShare": 3, "multiplyByFaultCount": true, "splitAmong": "CO_DISCOVERER" }
  },
  "groupBy": "incidentId"
}
```

### NORMALIZE（两票执行）— 方案 A，含单价表

```json
{
  "operationStepPrice": 0.01,
  "ticketPrices": {
    "workLeader":    { "总工作票": 5, "分工作票": 3, "单班组一种票": 3, "二种票": 1 },
    "workPermitter": { "总工作票": 1.5, "单班组一种票": 1, "二种票": 0.3 },
    "workMember":    { "单班组一种票": 1.5, "二种票": 0.5 }
  },
  "targetMaxScore": 30,
  "normalizeWithin": "declarationLevel"
}
```

两票计分两层：层 A（聚合：操作票 0.01/步 + 工作票按票种×角色单价 → rawScore）+ 层 B（折算：rawScore ÷ 同能级最高 × 30）。单价全进 config。

## 四、统一计分引擎（`scoring-engine.ts` 成为唯一入口）

`computeFactScores` 成为所有 4 个维度的唯一计分入口，按 `ruleType` dispatch：

```
computeFactScores(facts, rules[])
  ├ 按 dimensionCode 分组
  └ 逐组按 rule.ruleType dispatch：
      MATRIX    → processMatrix     (缺陷，已有，不改算法)
      SHARE     → processShare      (安全贡献，已有，不改算法)
      NORMALIZE → processNormalize  (两票，已有，扩展为含单价表聚合)
      BASIC_TIER→ processBasicTier  (基本素质，新增：tiers[code] ?? defaultScore)
```

唯一新增分支：`processBasicTier`（约 15 行）。NORMALIZE 扩展为「先按单价表算 rawScore，再折算」。

## 五、改造后导入流水线全貌

```
runImportPipeline(year, files)
  ├ basic:    parseBasicQuality → User + facts(tierValue, 无score)
  │           → 引擎 BASIC_TIER 算 score → 写 EmployeeBasicFact
  ├ ticket:   parseTicketExecution → 明细事实(票种/角色/步数, 无score)
  │           → 引擎 NORMALIZE 算 rawScore+折算 → 写 PerformanceFact
  ├ defect:   parseDefectGovernance → 事实(role/level, 无score)
  │           → 引擎 MATRIX 算 score → 写 PerformanceFact
  └ safety:   parseSafetyContribution → 事实(role/incident/faultCount/工号, 无score)
              → 引擎 SHARE 算 score → 写 PerformanceFact (新增 persistSafetyFacts)
```

## 六、dataSource 改动（`scoring-standards.ts`）

- `performance.safety-contribution`: `'manual'` → `'fact'`，`ruleType` `MANUAL_TIERS` → `SHARE`，补 `engineRuleType: 'SHARE'`
- 其余 3 个 fact 维度不变
- 手工维度（技术贡献/竞赛/创新/违章）不动

## 七、规则种子（`defaultScoringRuleConfigs`）

补齐 3 条 basic（共 6 条 ScoringRule），即 `docs/2025年能级评价量化积分表.md` 分值表的运行时镜像。两票 config 扩展为含单价表。`seed-scoring-rules.ts` 脚本一键灌库。

## 八、非目标

- 不改路径 A（`/api/admin/import/route.ts` 通用映射导入）的现有行为
- 不改手工维度（技术贡献/竞赛/创新/违章）
- 不改 `performance-score-sheet.ts` 的合并逻辑（它仍读 PerformanceFact/EmployeeBasicFact，只是这些事实现在由引擎算出 score）
- 不重写解析器，只拆 parse/score
- 不处理 `2025突出贡献奖汇总.xlsx`（按 2024 标准格式）
