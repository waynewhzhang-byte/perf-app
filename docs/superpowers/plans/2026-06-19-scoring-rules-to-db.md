# 计分规则统一进 DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 4 个系统导入维度（基本素质/两票/缺陷/安全贡献）的计分参数从解析器硬编码抽进 `ScoringRule` DB，统一由 `computeFactScores` 引擎算分；同时把安全贡献首次接入主导入链路（去单位过滤、改工号匹配）。

**Architecture:** 解析器与计分分层——解析器只产出结构化事实（role/level/tierValue/faultCount/incidentRef，无 score），引擎按 `ruleType` 读 DB config 算分。引擎新增 `BASIC_TIER` 分支，`NORMALIZE` 扩展为含单价表聚合。安全贡献复用现有 `safety-contribution.ts`，仅拆 parse/score、去单位过滤、改工号匹配，并接入 `import-pipeline`。

**Tech Stack:** TypeScript 5.6 (strict), Prisma 5.22 / PostgreSQL, Next.js 14 App Router, Zod 3, node:test + node:assert。

**Spec:** `docs/superpowers/specs/2026-06-19-scoring-rules-to-db-design.md`
**分值权威:** `docs/2025年能级评价量化积分表.md`

**Test command:** `pnpm test` (runs `src/lib/*.test.ts` via tsx --test)
**Lint/typecheck:** `pnpm tsc --noEmit`

---

## Phases Overview

| Phase | Tasks | Independently shippable? | Behavior change? |
|---|---|---|---|
| 1. 引擎地基 | T1, T2 | ✅ 全是新增/扩展，解析器未改 | 否（additive） |
| 2. 规则种子 | T3 | ✅ DB 数据 | 否 |
| 3. 解析器拆分 | T4, T5, T6, T7 | ✅ 逐维度，各自测试 | **是**（score 改由引擎算） |
| 4. 安全贡献接线 | T8 | ✅ safety 首次进主链路 | **是** |
| 5. 集成收尾 | T9 | ✅ 端到端 | 否 |

每个 Phase 结束 commit。Phase 1-2 不破坏现有测试（解析器仍 inline-score，引擎变更纯增量）。

---

## 关键设计：解析器拆分的统一模式

所有 4 个解析器遵循同一个重构模式，这是理解 T4-T7 的钥匙：

```
现状（parse + score 混合，参数硬编码）：
  buildXxxFacts(rows) → { facts:[{role, score}], byEmployee }   // score 用 LEVEL_SCORES 等常量算

目标（parse 只出事实，score 交引擎）：
  parseXxxFacts(rows) → { facts:[{role, level, ...}], unmatchedNameMap }   // 无 score
  computeFactScores(facts, dbRule) → { scoredFacts:[{...score}], byEmployee }   // 引擎套 DB 参数
```

**事实不再携带 `score` 字段**，改由引擎输出。聚合（rawScore/cappedScore）也从解析器移到引擎（或共享 `aggregateFactsByEmployee` 工具）。

---

# Phase 1 — 引擎地基（新增 BASIC_TIER + 扩展 NORMALIZE）

### Task 1: 新增 BASIC_TIER 引擎分支 + API config schema

**Files:**
- Modify: `src/lib/scoring-engine.ts` (新增 `processBasicTier`)
- Modify: `src/lib/scoring-engine.test.ts` (新增测试)
- Modify: `src/app/api/admin/scoring-rules/route.ts:10` (RULE_TYPES 加 BASIC_TIER) 及 `:35` (ConfigByType)

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/scoring-engine.test.ts`：

```ts
import { computeFactScores } from './scoring-engine';

describe('computeFactScores BASIC_TIER', () => {
  const rule = {
    id: 'r-basic', dimensionCode: 'basic.skill-level', ruleType: 'BASIC_TIER' as const,
    cap: 6, enabled: true,
    config: { tiers: { '高级技师': 4, '技师': 3 }, defaultScore: 1 },
  };
  it('命中档位 → 取 tier 值', () => {
    const facts = [
      fact({ employeeNo: '001', tierValue: '高级技师' }),
      fact({ employeeNo: '002', tierValue: '技师' }),
    ];
    const scored = computeFactScores(facts, [rule]);
    assert.equal(findEmp(scored, '001').score, 4);
    assert.equal(findEmp(scored, '002').score, 3);
  });
  it('档位未配置 → 取 defaultScore', () => {
    const scored = computeFactScores([fact({ employeeNo: '003', tierValue: '未知' })], [rule]);
    assert.equal(findEmp(scored, '003').score, 1);
  });
  it('受 cap 限制', () => {
    const r = { ...rule, cap: 2 };
    const scored = computeFactScores([fact({ employeeNo: '001', tierValue: '高级技师' })], [r]);
    assert.equal(findEmp(scored, '001').score, 2);
  });
});
```

其中 `fact({...})` / `findEmp` 是该测试文件已存在的 helper（若没有则补最小版本）：

```ts
const fact = (over: Record<string, unknown>) => ({
  dimensionCode: 'basic.skill-level', year: 2024, employeeNo: 'x', employeeName: 'n', ...over,
});
const findEmp = (res: any, no: string) => res.byEmployee.find((e: any) => e.employeeNo === no);
```

（先读现有测试文件确认 helper 名称；若 `computeFactScores` 返回结构不含 `byEmployee`，按其真实返回结构调整断言——见 Step 3。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/scoring-engine.test.ts`
Expected: FAIL — `BASIC_TIER` 未被 dispatch（或 `processBasicTier` 未定义）。

- [ ] **Step 3: 实现 `processBasicTier`**

在 `src/lib/scoring-engine.ts` 加（紧跟 `processNormalize` 之后）：

```ts
interface BasicTierConfig {
  tiers: Record<string, number>;
  defaultScore?: number;
}

function processBasicTier(
  facts: EngineFact[],
  rule: ScoringRuleConfig,
): ScoredFact[] {
  const cfg = rule.config as unknown as BasicTierConfig;
  const tiers = cfg.tiers ?? {};
  const def = cfg.defaultScore ?? 0;
  return facts.map((f) => {
    const tierValue = String(f.tierValue ?? '');
    const raw = Object.prototype.hasOwnProperty.call(tiers, tierValue)
      ? tiers[tierValue]
      : def;
    return {
      ...f,
      score: Math.min(raw, rule.cap),
      rawScore: raw,
    };
  });
}
```

在 `computeFactScores` 的 dispatch 处加分支（找到 `switch (rule.ruleType)` 或 `if` 链）：

```ts
case 'BASIC_TIER':
  return processBasicTier(groupFacts, rule);
```

注意：`EngineFact` / `ScoringRuleConfig` / `ScoredFact` 类型以文件内现有定义为准（先读文件顶部确认）。若 `EngineFact` 无 `tierValue` 字段，在类型里加 `tierValue?: string`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/lib/scoring-engine.test.ts`
Expected: PASS。

- [ ] **Step 5: 同步 API 校验 schema**

`src/app/api/admin/scoring-rules/route.ts:10`：

```ts
const RULE_TYPES = ['MATRIX', 'SHARE', 'NORMALIZE', 'BASIC_TIER'] as const;
```

`:12` 之后加 config schema：

```ts
const BasicTierConfigSchema = z.object({
  tiers: z.record(z.string(), z.number()),
  defaultScore: z.number().optional(),
});
```

`:35` `ConfigByType` 加：

```ts
BASIC_TIER: BasicTierConfigSchema,
```

- [ ] **Step 6: typecheck**

Run: `pnpm tsc --noEmit`
Expected: 无错误。

- [ ] **Step 7: commit**

```bash
git add src/lib/scoring-engine.ts src/lib/scoring-engine.test.ts src/app/api/admin/scoring-rules/route.ts
git commit -m "feat(scoring): add BASIC_TIER engine branch + API schema"
```

---

### Task 2: 扩展 NORMALIZE —— 两票单价表进 config

**Files:**
- Modify: `src/lib/scoring-engine.ts` (`processNormalize` 扩展为「先单价聚合，再折算」)
- Modify: `src/lib/scoring-engine.test.ts`
- Modify: `src/app/api/admin/scoring-rules/route.ts:29` (NormalizeConfigSchema 扩展)

两票计分两层：(A) 操作票 `operationStepPrice × steps` + 工作票 `ticketPrices[role][ticketType]` → rawScore；(B) rawScore ÷ 同能级最高 × `targetMaxScore`。

- [ ] **Step 1: 写失败测试**

```ts
describe('computeFactScores NORMALIZE (ticket unit prices)', () => {
  const rule = {
    id: 'r-ticket', dimensionCode: 'worksite.ticket-execution', ruleType: 'NORMALIZE' as const,
    cap: 30, enabled: true,
    config: {
      operationStepPrice: 0.01,
      ticketPrices: {
        workLeader: { '总工作票': 5 },
        workPermitter: { '总工作票': 1.5 },
        workMember: {},
      },
      targetMaxScore: 30,
      normalizeWithin: 'declarationLevel',
    },
  };
  it('操作票按步数 × operationStepPrice 算 rawScore', () => {
    const f = [fact({ employeeNo: '001', ticketKind: 'operation', steps: 100, declarationLevel: 'L2' })];
    const scored = computeFactScores(f, [rule]);
    assert.equal(findEmp(scored, '001').rawScore, 1);
  });
  it('工作票按 ticketPrices[role][ticketType] 算 rawScore', () => {
    const f = [fact({ employeeNo: '002', ticketKind: 'work', ticketType: '总工作票', workRole: 'workLeader', declarationLevel: 'L2' })];
    const scored = computeFactScores(f, [rule]);
    assert.equal(findEmp(scored, '002').rawScore, 5);
  });
  it('折算：rawScore ÷ 组内最高 × targetMaxScore', () => {
    const f = [
      fact({ employeeNo: 'hi', ticketKind: 'work', ticketType: '总工作票', workRole: 'workLeader', declarationLevel: 'L2' }),  // raw 5
      fact({ employeeNo: 'lo', ticketKind: 'operation', steps: 50, declarationLevel: 'L2' }),  // raw 0.5
    ];
    const scored = computeFactScores(f, [rule]);
    // lo: 0.5/5*30 = 3
    assert.equal(findEmp(scored, 'lo').score, 3);
  });
  it('无单价配置时退化为旧 NORMALIZE（rawScore 已在 fact 上）', () => {
    const legacyRule = { ...rule, config: { targetMaxScore: 30, normalizeWithin: 'declarationLevel' } };
    const f = [fact({ employeeNo: '009', rawScore: 10, declarationLevel: 'L2' })];
    const scored = computeFactScores(f, [legacyRule]);
    assert.equal(findEmp(scored, '009').score, 30); // 10/10*30
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/scoring-engine.test.ts`
Expected: FAIL（现有 `processNormalize` 不认 `ticketPrices`/`steps`）。

- [ ] **Step 3: 扩展 `processNormalize`**

在 `src/lib/scoring-engine.ts` 找到 `processNormalize`，改造为：先判断 config 是否含单价表——若有，从事实的 `steps`/`ticketType`/`workRole` 算 rawScore；若无，沿用旧逻辑（fact.rawScore）。然后折算。完整函数（替换现有 `processNormalize`）：

```ts
interface TicketPriceConfig {
  operationStepPrice?: number;
  ticketPrices?: {
    workLeader?: Record<string, number>;
    workPermitter?: Record<string, number>;
    workMember?: Record<string, number>;
  };
}

function computeTicketRawScore(f: EngineFact, cfg: TicketPriceConfig): number {
  // 操作票
  if (f.ticketKind === 'operation' && cfg.operationStepPrice != null && typeof f.steps === 'number') {
    return cfg.operationStepPrice * f.steps;
  }
  // 工作票
  if (f.ticketKind === 'work' && cfg.ticketPrices && f.workRole && f.ticketType) {
    const table = cfg.ticketPrices[f.workRole as keyof typeof cfg.ticketPrices];
    return table?.[String(f.ticketType)] ?? 0;
  }
  // 退化为 fact 上的 rawScore（兼容旧路径）
  return typeof f.rawScore === 'number' ? f.rawScore : 0;
}

function processNormalize(facts: EngineFact[], rule: ScoringRuleConfig): ScoredFact[] {
  const cfg = rule.config as unknown as NormalizeConfig & TicketPriceConfig;
  const target = cfg.targetMaxScore;
  const withinKey = cfg.normalizeWithin ?? 'declarationLevel';

  const hasUnitPrices = cfg.operationStepPrice != null || cfg.ticketPrices != null;
  const withRaw = facts.map((f) => ({
    f,
    raw: hasUnitPrices ? computeTicketRawScore(f, cfg) : (typeof f.rawScore === 'number' ? f.rawScore : 0),
  }));

  // 组内最高
  const maxByGroup = new Map<string, number>();
  for (const { f, raw } of withRaw) {
    const g = String((f as Record<string, unknown>)[withinKey] ?? '_all');
    maxByGroup.set(g, Math.max(maxByGroup.get(g) ?? 0, raw));
  }

  return withRaw.map(({ f, raw }) => {
    const g = String((f as Record<string, unknown>)[withinKey] ?? '_all');
    const max = maxByGroup.get(g) ?? 0;
    const normalized = max > 0 ? (raw / max) * target : 0;
    return { ...f, rawScore: raw, score: Math.min(normalized, rule.cap) };
  });
}
```

注：`EngineFact` 加可选字段 `ticketKind?: 'operation'|'work'`, `steps?: number`, `ticketType?: string`, `workRole?: string`, `rawScore?: number`。`NormalizeConfig` 类型若在文件内定义，加可选 `operationStepPrice`/`ticketPrices`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/lib/scoring-engine.test.ts`
Expected: PASS（新测试 + 原 NORMALIZE 测试都过）。

- [ ] **Step 5: 扩展 API NormalizeConfigSchema**

`src/app/api/admin/scoring-rules/route.ts:29`：

```ts
const NormalizeConfigSchema = z.object({
  targetMaxScore: z.number().min(1),
  sourceKey: z.string().optional(),
  normalizeWithin: z.string().optional(),
  operationStepPrice: z.number().optional(),
  ticketPrices: z.object({
    workLeader: z.record(z.string(), z.number()).optional(),
    workPermitter: z.record(z.string(), z.number()).optional(),
    workMember: z.record(z.string(), z.number()).optional(),
  }).optional(),
});
```

- [ ] **Step 6: typecheck + commit**

Run: `pnpm tsc --noEmit` → 无错误。
```bash
git add src/lib/scoring-engine.ts src/lib/scoring-engine.test.ts src/app/api/admin/scoring-rules/route.ts
git commit -m "feat(scoring): NORMALIZE supports ticket unit-price aggregation"
```

---

# Phase 2 — 规则种子（defaultScoringRuleConfigs 补全 6 条）

### Task 3: 补全 defaultScoringRuleConfigs + 扩展 ticket config

**Files:**
- Modify: `src/lib/scoring-standards.ts` (`defaultScoringRuleConfigs`)
- Modify: `scripts/seed-scoring-rules.ts` (确认覆盖 basic)
- Test: `src/lib/scoring-standards.test.ts`（若不存在则新建）

- [ ] **Step 1: 写失败测试**

新建或追加到 `src/lib/scoring-standards.test.ts`：

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultScoringRuleConfigs } from './scoring-standards';

describe('defaultScoringRuleConfigs', () => {
  const cfgs = defaultScoringRuleConfigs();
  const codes = cfgs.map((c) => c.dimensionCode);

  it('覆盖 4 个系统导入维度共 6 条规则', () => {
    for (const c of ['basic.skill-level', 'basic.title-level', 'basic.performance-level',
                     'worksite.defect-governance', 'worksite.ticket-execution',
                     'performance.safety-contribution']) {
      assert.ok(codes.includes(c), `missing ${c}`);
    }
    assert.equal(cfgs.length, 6);
  });
  it('basic.skill-level BASIC_TIER 含高级技师=4', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'basic.skill-level')!;
    assert.equal(c.ruleType, 'BASIC_TIER');
    assert.equal((c.config as any).tiers['高级技师'], 4);
  });
  it('ticket NORMALIZE 含 operationStepPrice + ticketPrices', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'worksite.ticket-execution')!;
    assert.equal(c.ruleType, 'NORMALIZE');
    assert.equal((c.config as any).operationStepPrice, 0.01);
    assert.equal((c.config as any).ticketPrices.workLeader['总工作票'], 5);
  });
  it('safety SHARE 含 perIncident=3', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'performance.safety-contribution')!;
    assert.equal(c.ruleType, 'SHARE');
    assert.equal((c.config as any).roles.FIRST_DISCOVERER.perIncident, 3);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/scoring-standards.test.ts`
Expected: FAIL（basic 三条缺失；ticket config 无 ticketPrices）。

- [ ] **Step 3: 补全 defaultScoringRuleConfigs**

在 `src/lib/scoring-standards.ts` 找到 `defaultScoringRuleConfigs()`，替换为返回全部 6 条（分值对照 `docs/2025年能级评价量化积分表.md`）：

```ts
export function defaultScoringRuleConfigs(): Array<{
  dimensionCode: string;
  ruleType: 'BASIC_TIER' | 'MATRIX' | 'SHARE' | 'NORMALIZE';
  cap: number;
  enabled: boolean;
  config: Record<string, unknown>;
}> {
  return [
    // ── 基本素质 ──
    {
      dimensionCode: 'basic.skill-level',
      ruleType: 'BASIC_TIER',
      cap: 6, enabled: true,
      config: { tiers: { '高级技师': 4, '技师': 3, '高级工': 2, '中级工': 1 }, defaultScore: 1 },
    },
    {
      dimensionCode: 'basic.title-level',
      ruleType: 'BASIC_TIER',
      cap: 6, enabled: true,
      config: { tiers: { '正高级': 4, '副高级': 4, '中级': 3, '初级': 2 }, defaultScore: 0 },
    },
    {
      dimensionCode: 'basic.performance-level',
      ruleType: 'BASIC_TIER',
      cap: 6, enabled: true,
      config: { tiers: { '3A': 6, '2A1B': 5.5, '1A2B': 5, '3B': 4.5 }, defaultScore: 4 },
    },
    // ── 缺陷治理 ──
    {
      dimensionCode: 'worksite.defect-governance',
      ruleType: 'MATRIX',
      cap: 12, enabled: true,
      config: {
        matrix: {
          '危急': { FIRST_DISCOVERER: 3, CO_DISCOVERER: 1, FIRST_HANDLER: 3, CO_HANDLER: 1 },
          '严重': { FIRST_DISCOVERER: 1, CO_DISCOVERER: 0.5, FIRST_HANDLER: 1, CO_HANDLER: 0.5 },
          '一般': { FIRST_DISCOVERER: 0.5, FIRST_HANDLER: 0.5 },
        },
        tieBreak: 'MAX_PER_PERSON',
      },
    },
    // ── 两票执行 ──
    {
      dimensionCode: 'worksite.ticket-execution',
      ruleType: 'NORMALIZE',
      cap: 30, enabled: true,
      config: {
        operationStepPrice: 0.01,
        ticketPrices: {
          workLeader:    { '总工作票': 5, '分工作票': 3, '单班组一种票': 3, '二种票': 1 },
          workPermitter: { '总工作票': 1.5, '单班组一种票': 1, '二种票': 0.3 },
          workMember:    { '单班组一种票': 1.5, '二种票': 0.5 },
        },
        targetMaxScore: 30,
        normalizeWithin: 'declarationLevel',
      },
    },
    // ── 安全贡献 ──
    {
      dimensionCode: 'performance.safety-contribution',
      ruleType: 'SHARE',
      cap: 12, enabled: true,
      config: {
        roles: {
          FIRST_DISCOVERER: { perIncident: 3, multiplyByFaultCount: true },
          CO_DISCOVERER: { totalShare: 3, multiplyByFaultCount: true, splitAmong: 'CO_DISCOVERER' },
        },
        groupBy: 'incidentId',
      },
    },
  ];
}
```

注意：原文件可能已有 defect/ticket/safety 三条旧 config，用上面的完整版**替换**它们（旧 ticket config 不含 ticketPrices，必须替换）。

> **T3 必须同时修复 `engineRuleType` 联合类型**（Task 1 review 发现的下游缺口）：`src/lib/scoring-standards.ts` 中 `engineRuleType?: 'MATRIX' | 'SHARE' | 'NORMALIZE'` 要扩成含 `'BASIC_TIER'`，否则三条 basic 标准（`ruleType: 'BASIC_TIER'`）无法映射到引擎分支。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/lib/scoring-standards.test.ts`
Expected: PASS。

- [ ] **Step 5: 更新 scoring-standards 维度声明：safety 改 fact**

⚠️ **本 Step 推迟到 Task 8**（实现期发现）。单独翻转 `dataSource: 'manual' → 'fact'` 会让 `performance-score-sheet.ts` 把 safety 当 fact 维度处理，但 score-sheet 的 safety fact 分支要到 Task 8 才加——中途翻转会让 safety 得分在 T3~T8 之间恒为 0，并破坏 `performance-score-sheet.test.ts` / `submission-fact-persistence.test.ts`（它们断言旧的 MANUAL 行为）。**Task 8 在同一次提交里同时**：(a) 翻转 `dataSource`→`'fact'` + `ruleType`→`'SHARE'`；(b) 加 score-sheet safety fact 分支；(c) 更新这两个测试。T3 只修 `engineRuleType` 联合类型。

- [ ] **Step 6: 确认 seed 脚本覆盖**

读 `scripts/seed-scoring-rules.ts`，确认它调用 `defaultScoringRuleConfigs()` 并 upsert 全部条目（应已如此，因 T3 改了返回值即生效）。若脚本硬编码了维度列表，补 basic 三条。

- [ ] **Step 7: typecheck + commit**

Run: `pnpm tsc --noEmit` → 无错误。
```bash
git add src/lib/scoring-standards.ts src/lib/scoring-standards.test.ts scripts/seed-scoring-rules.ts
git commit -m "feat(scoring): seed 6 default rules incl. BASIC_TIER + ticket prices"
```

---

# Phase 3 — 解析器拆分（逐维度，每维度独立可测）

> 4 个解析器遵循同一模式（见「关键设计」）。每个 Task：删掉硬编码常量 → parse 出无 score 的事实 → 调 `computeFactScores` 算分 → 聚合。下面 T4（缺陷，MATRIX）给出最完整示范；T5/T6/T7 同构。

### Task 4: 缺陷治理 LEVEL_SCORES → 引擎矩阵查询（参数从 DB 读）

> **实现期修正（原计划假设引擎可替代 inline 计分，实测分组语义不同）：**
> - 引擎 `processMatrix` 按 `(employeeNo, defectLevel)` 分组，每组**只保留最高分一条**事实。
> - 解析器 `dedupeSamePersonOnDefect` 按 `(name, defect)` 去重，但**保留所有不同缺陷并累加**。
> - 二者对「同一人多个缺陷」语义不同：引擎会丢事实，解析器会累加。**不能**用单次 `computeFactScores` 替代解析器。
> 因此采用**更小、更安全的改造**：解析器的去重/累加逻辑保留不动，仅把「查分数」从硬编码 `LEVEL_SCORES` 改为查 DB 规则的 matrix。

**Files:**
- Modify: `src/lib/defect-governance.ts` (删 `LEVEL_SCORES`；`buildFactsFromDefectRows` 接收 `scoreMatrix` 参数；`roleLines` 用它查分)

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/defect-governance.test.ts`：

```ts
import { buildFactsFromDefectRows } from './defect-governance';

describe('buildFactsFromDefectRows (从 scoreMatrix 查分，非硬编码)', () => {
  const resolver = { resolve: (n: string) => ({ employeeNo: 'E-' + n, employeeName: n }) };
  const matrix = {
    危急: { FIRST_DISCOVERER: 3, CO_DISCOVERER: 1, FIRST_HANDLER: 3, CO_HANDLER: 1 },
    严重: { FIRST_DISCOVERER: 1, CO_DISCOVERER: 0.5, FIRST_HANDLER: 1, CO_HANDLER: 0.5 },
    一般: { FIRST_DISCOVERER: 0.5, FIRST_HANDLER: 0.5 },
  };
  const rows = [
    { 编号: 'Q001', 等级: '危急', 发现人: '张三', 消缺人: '', 发现时间: '2024-1-1', 问题状态: '', 所属类别: '缺陷' },
    { 编号: 'Q002', 等级: '一般', 发现人: '李四', 消缺人: '', 发现时间: '2024-1-1', 问题状态: '', 所属类别: '缺陷' },
  ];
  it('事实 score 来自传入的 scoreMatrix', () => {
    const res = buildFactsFromDefectRows(rows as any, 2024, resolver, {}, matrix);
    const zhang = res.facts.find((f) => f.employeeName === '张三')!;
    assert.equal(zhang.score, 3); // 危急 FIRST_DISCOVERER
    const li = res.facts.find((f) => f.employeeName === '李四')!;
    assert.equal(li.score, 0.5); // 一般 FIRST_DISCOVERER
  });
  it('修改 matrix 参数即改变分数（验证不依赖硬编码）', () => {
    const doubled = JSON.parse(JSON.stringify(matrix));
    doubled.危急.FIRST_DISCOVERER = 9;
    const res = buildFactsFromDefectRows([rows[0]] as any, 2024, resolver, {}, doubled);
    assert.equal(res.facts[0].score, 9);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/defect-governance.test.ts` → FAIL（`buildFactsFromDefectRows` 当前不接受 `scoreMatrix` 参数）。

- [ ] **Step 3: 改 `buildFactsFromDefectRows` 接收 scoreMatrix**

`src/lib/defect-governance.ts`：
- 删除 `LEVEL_SCORES` 常量（line 88-95）。
- `roleLines(people, level, kind, matrix)` 加第 4 参数 `matrix`，内部 `matrix[level]?.firstDiscoverer` 替代 `LEVEL_SCORES[level].firstDiscoverer`（其余 co/firstHandler/coHandler 同理；`maxCo` 改为 `matrix[level]?.coDiscoverer ? 1 : 0` 或从 matrix 派生）。
- `buildFactsFromDefectRows(rows, year, resolveName, options, scoreMatrix)` 加第 5 参数。`roleLines` 调用处传入。`score: line.score` 保留（line 299 不变）——分数值现在来自 matrix 参数。
- 为了向后兼容（旧调用方不传 matrix），参数默认值用 T3 种子的默认 matrix：从 `defaultScoringRuleConfigs()` 找 defect 那条的 `config.matrix` 作为 `scoreMatrix ?? DEFAULT_DEFECT_MATRIX`。这样旧测试（不传 matrix）行为不变。

- [ ] **Step 4: 接线 —— pipeline 从 DB 读 matrix 传入**

`src/lib/import-pipeline.ts` 调 `buildFactsFromDefectRows` 处（约 line 167）：从 DB 读 `worksite.defect-governance` 的 ScoringRule，取 `config.matrix` 传入。若 DB 无规则，回退 `defaultScoringRuleConfigs()` 的默认 matrix。加一个 `loadDefectMatrix(prisma, year)` helper（或复用通用的 `loadRule`）。

- [ ] **Step 5: 测试 + typecheck + commit**

Run: `pnpm test` → 全绿（新测试 + 旧 defect 测试不传 matrix 走默认，行为不变）。
`pnpm tsc --noEmit` → 无错误。
```bash
git add src/lib/defect-governance.ts src/lib/defect-governance.test.ts src/lib/import-pipeline.ts
git commit -m "refactor(defect): LEVEL_SCORES → DB rule matrix lookup"
```

---

### Task 5: 基本素质 parse/score 拆分

**Files:**
- Modify: `src/lib/basic-quality.ts` (`scoreSkillLevel/scoreTitleLevel/scorePerformanceLevel` → 退化为只归一档位/组合码，不算分)
- Modify: `src/lib/basic-quality.test.ts`
- Modify: `src/lib/basic-quality-import.ts` (写 `EmployeeBasicFact` 时 score 由引擎算)

- [ ] **Step 1: 写失败测试**

`basic-quality.test.ts` 现有测试断言 `scoreSkillLevel('高级技师') === 4`。改造后这些函数应只返回档位码（归一），score 由引擎查 `tiers`。改测试：

```ts
describe('normalizeSkillLevel (parse only)', () => {
  it('返回归一档位码，不算分', () => {
    assert.equal(normalizeSkillLevel('高级技师'), '高级技师');
    assert.equal(normalizeSkillLevel('  技师  '), '技师');
    assert.equal(normalizeSkillLevel(null), '');        // 空→引擎取 defaultScore
    assert.equal(normalizeSkillLevel('未知'), '未知');
  });
});
describe('normalizePerformanceLevel (parse only)', () => {
  it('返回组合码，不算分', () => {
    assert.deepEqual(normalizePerformanceLevel(['A','A','A']), { code: '3A', complete: true });
    assert.deepEqual(normalizePerformanceLevel(['A','B',null]), { code: '其他', complete: false });
  });
});
```

（`normalizeTitleLevel` 同理。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/basic-quality.test.ts` → FAIL。

- [ ] **Step 3: 改造 basic-quality.ts**

把 `scoreSkillLevel/scoreTitleLevel/scorePerformanceLevel` 重命名为 `normalizeSkillLevel/normalizeTitleLevel/normalizePerformanceLevel`，只返回码（`string` / `{code, complete}`），删掉内部档位→分数表（这些值已在 T3 的 config.tiers）。`normalizePerformanceLevel` 保留 A/B 计数逻辑产出组合码（3A/2A1B/.../其他），但不算 score。

- [ ] **Step 4: basic-quality-import.ts 接线**

`basic-quality-import.ts:299-332` 写 `EmployeeBasicFact` 处：原 `scoreValue = scoreSkillLevel(v)`，改为 `tierValue = normalizeSkillLevel(v)`，然后调引擎 `computeFactScores([{dimensionCode:'basic.skill-level', tierValue, ...}], [rule])` 取 score 写入。`dimension` 字段（SKILL_LEVEL/TITLE_LEVEL/PERFORMANCE_LEVEL）对应三条 rule（T3 已配）。

- [ ] **Step 5: 测试 + typecheck + commit**

Run: `pnpm test src/lib/basic-quality.test.ts` → PASS。`pnpm tsc --noEmit` → 无错误。
```bash
git add src/lib/basic-quality.ts src/lib/basic-quality.test.ts src/lib/basic-quality-import.ts
git commit -m "refactor(basic-quality): split normalize/score; tier tables moved to DB"
```

---

### Task 6: 两票执行 parse/score 拆分

**Files:**
- Modify: `src/lib/ticket-execution-import.ts` (删 `OP_SCORE_PER_STEP`/`WORK_*_SCORE` 常量 line 35-55；`aggregateTicketExecutionFromFile` 改为产明细事实)
- Modify: `src/lib/ticket-execution-import.test.ts`（若不存在则新建）

- [ ] **Step 1: 写失败测试**

```ts
import { parseTicketExecutionFromFile } from './ticket-execution-import';

describe('parseTicketExecutionFromFile (明细事实，无 score)', () => {
  it('操作票→{ticketKind:operation, steps}', () => {
    const facts = parseTicketExecutionFromFile('《工作现场-两票执行》.xlsx', { year: 2024 });
    const op = facts.find((f:any) => f.ticketKind === 'operation');
    assert.ok(op);
    assert.equal(typeof op.steps, 'number');
    assert.equal(op.score, undefined);
  });
  it('工作票→{ticketKind:work, ticketType, workRole}', () => {
    const facts = parseTicketExecutionFromFile('《工作现场-两票执行》.xlsx', { year: 2024 });
    const work = facts.find((f:any) => f.ticketKind === 'work');
    assert.ok(['workLeader','workPermitter','workMember'].includes(work.workRole));
    assert.equal(work.score, undefined);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/ticket-execution-import.test.ts` → FAIL。

- [ ] **Step 3: 改造解析器产明细事实**

`src/lib/ticket-execution-import.ts`：
- 删 `OP_SCORE_PER_STEP`、`WORK_LEADER_SCORE`/`WORK_PERMITTER_SCORE`/`WORK_MEMBER_SCORE`（line 35-55）。
- `aggregateTicketExecutionFromFile`（line 137）改为 `parseTicketExecutionFromFile`：不再 `points = steps * OP_SCORE_PER_STEP`（line 157）、不再查 `WORK_*_SCORE[ticketType]`（line 183-185）。改为对每个（员工, 票）产出一条明细事实：操作票 `{ticketKind:'operation', steps, employeeNo, declarationLevel}`；工作票按负责人/许可人/班员各产事实 `{ticketKind:'work', ticketType, workRole:'workLeader'|'workPermitter'|'workMember', employeeNo, declarationLevel}`。
- 删 `addPoints`/`getBucket`/`TicketScoreBreakdown` 聚合（line 11-110，score 累加移到引擎）。

- [ ] **Step 4: 接线 scoreTicketFacts**

末尾加：

```ts
import { computeFactScores } from './scoring-engine';
export function scoreTicketFacts(facts, rule) {
  return computeFactScores(facts.map(f=>({...f, rawScore: 0})), [{
    id:'ticket', dimensionCode: TICKET_DIMENSION, ruleType: rule.ruleType,
    cap: rule.cap, enabled:true, config: rule.config,
  }]);
}
```

- [ ] **Step 5: 更新调用方 + 测试 + typecheck + commit**

`fact-import-persistence.ts` ticket 持久化处：parse → `scoreTicketFacts` → 写 PerformanceFact。
Run: `pnpm test` → PASS。`pnpm tsc --noEmit` → 无错误。
```bash
git add src/lib/ticket-execution-import.ts src/lib/ticket-execution-import.test.ts src/lib/fact-import-persistence.ts
git commit -m "refactor(ticket): split parse/score; unit prices moved to DB"
```

---

### Task 7: 安全贡献 parse/score 拆分 + 去单位过滤 + 工号匹配

**Files:**
- Modify: `src/lib/safety-contribution.ts` (删 `BASE_POINTS`/`DIMENSION_CAP` 计分 line 77/275；删 `belongsToUnit` 调用 line 99-101/165；`scoreSafetyContributionEntries` 改为只 parse)
- Modify: `src/lib/safety-contribution.test.ts`（若不存在则新建）

- [ ] **Step 1: 写失败测试**

```ts
import { parseSafetyContributionFromFile } from './safety-contribution';

describe('parseSafetyContributionFromFile (parse only, 工号匹配, 无单位过滤)', () => {
  const res = parseSafetyContributionFromFile('2024年突出贡献奖明细表.xlsx', { year: 2024 });
  it('全量导入（不按单位过滤）', () => {
    assert.ok(res.entries.length > 100, `期望 >100 实得 ${res.entries.length}`);
  });
  it('每条 entry 携带 employeeNo（col5）', () => {
    assert.ok(res.entries.every(e => e.employeeNo));
  });
  it('事实不含 score', () => {
    assert.ok(res.facts.every((f:any) => f.score === undefined));
  });
  it('保留 role/incidentRef/faultCount 供引擎', () => {
    const f = res.facts[0] as any;
    assert.ok(['FIRST_DISCOVERER','CO_DISCOVERER'].includes(f.role));
    assert.ok(f.incidentRef);
    assert.equal(typeof f.faultCount, 'number');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/safety-contribution.test.ts` → FAIL（当前按单位过滤只进 ~9 条，且 facts 有 score）。

- [ ] **Step 3: 去单位过滤 + 改 parse**

`src/lib/safety-contribution.ts`：
- line 165 `if (belongsToUnit(entry, unit)) entries.push(entry);` → `entries.push(entry);`（全量）。line 99-101 `belongsToUnit` 函数删除。
- `parseSafetyContributionMatrix`（line 134）的 `options.unit` 参数删除（全量导入）。`filterNote`（line 171-178）改为 `'全量导入，按工号(col5)匹配员工基本信息表；子项封顶 ${DIMENSION_CAP} 分。'`。
- `scoreSafetyContributionEntries`（line 187）拆分：保留**分组 + 角色判定 + parseFaultCountFromReason**（业务逻辑），删除 `firstPoints = BASE_POINTS * faultCount`、`otherShare = ...`（line 204-210）——这些分值由引擎 SHARE 读 config。拆出 `parseSafetyContributionEntries(entries)` 只产 `{role, incidentRef, faultCount, employeeNo, employeeName, metadata}`，无 score。删 `BASE_POINTS`（line 77）。
- `importSafetyContributionFacts`（line 296）：原来调 `scoreSafetyContributionEntries`，改为调 parse。工号匹配：解析器已从 col5 取 `employeeNo`，**不再调 `resolveName(fullName)`**（line 218 改为直接用 entry.employeeNo，仍校验非空）。

- [ ] **Step 4: 加 scoreSafetyFacts 引擎封装**

末尾加：

```ts
import { computeFactScores } from './scoring-engine';
export function scoreSafetyFacts(facts, rule) {
  return computeFactScores(facts.map(f=>({
    ...f, incidentId: f.incidentRef,
  })), [{
    id:'safety', dimensionCode: SAFETY_CONTRIBUTION_DIMENSION.code, ruleType: rule.ruleType,
    cap: rule.cap, enabled:true, config: rule.config,
  }]);
}
```

- [ ] **Step 5: 运行测试 + typecheck + commit**

Run: `pnpm test src/lib/safety-contribution.test.ts src/lib/scoring-engine.test.ts` → PASS。
`pnpm tsc --noEmit` → 无错误。
```bash
git add src/lib/safety-contribution.ts src/lib/safety-contribution.test.ts
git commit -m "refactor(safety): split parse/score; drop unit filter; employeeNo matching"
```

---

# Phase 4 — 安全贡献接入主链路

### Task 8: persistSafetyFacts + import-pipeline 接线 + score-sheet 分支

**Files:**
- Modify: `src/lib/fact-import-persistence.ts` (新增 `persistSafetyFacts`)
- Modify: `src/lib/import-pipeline.ts` (import + 调用 safety)
- Modify: `src/lib/performance-score-sheet.ts` (safety fact 分支)
- Modify: `scripts/import-facts-pipeline.ts` (CLI 支持 safety 文件)

- [ ] **Step 1: 写持久化测试（失败）**

`src/lib/fact-import-persistence.test.ts`（若不存在新建）加：

```ts
// mock prisma，测 persistSafetyFacts 先 deleteMany(year+dimension) 再 upsert scoredFacts
```

（具体断言：调用后 `prisma.performanceFact.deleteMany` 被以 `{year, dimensionCode:'performance.safety-contribution'}` 调用一次；upsert 次数 = scoredFacts 数。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/fact-import-persistence.test.ts` → FAIL。

- [ ] **Step 3: 实现 persistSafetyFacts**

`src/lib/fact-import-persistence.ts` 仿照现有 `persistTicketAggregates` / defect 持久化，加：

```ts
export async function persistSafetyFacts(
  scoredFacts: Array<{ dimensionCode: string; year: number; employeeNo: string; employeeName: string;
    role: string; score: number; rawScore: number; incidentRef: string; metadata: Record<string, unknown> }>,
  year: number,
): Promise<{ upserted: number }> {
  await prisma.performanceFact.deleteMany({ where: { year, dimensionCode: 'performance.safety-contribution' } });
  for (const f of scoredFacts) {
    await prisma.performanceFact.upsert({
      where: { year_employeeNo_dimensionCode_defectRef_role_eventType: {
        year, employeeNo: f.employeeNo, dimensionCode: 'performance.safety-contribution',
        defectRef: f.incidentRef, role: f.role, eventType: 'SAFETY',
      }},
      create: { /* 映射全部字段，score: f.score, rawScore: f.rawScore, metadata: f.metadata */ },
      update: { score: f.score, rawScore: f.rawScore },
    });
  }
  return { upserted: scoredFacts.length };
}
```

（唯一约束字段名以 `prisma/schema.prisma` 的 `PerformanceFact` @@unique 为准——复核 `year_employeeNo_dimensionCode_defectRef_role_eventType`。）

- [ ] **Step 4: import-pipeline.ts 接线**

`src/lib/import-pipeline.ts` line 1-26 import 列表加：

```ts
import { parseSafetyContributionFromFile, scoreSafetyFacts } from './safety-contribution';
import { persistSafetyFacts } from './fact-import-persistence';
```

`runImportPipeline` 加 safety 步骤（仿 basic/ticket/defect 块）：

```ts
if (files.safety) {
  const parsed = parseSafetyContributionFromFile(files.safety, { year });
  const rule = await loadRule('performance.safety-contribution');  // 从 DB 读，T9 默认兜底
  const scored = scoreSafetyFacts(parsed.facts, rule);
  await persistSafetyFacts(scored.scoredFacts, year);
  summary.safety = { entries: parsed.entries.length, facts: scored.scoredFacts.length };
}
```

（`loadRule` helper 若不存在，加一个从 `prisma.scoringRule.findUnique` 读 + 缺省回退 `defaultScoringRuleConfigs()` 的工具。）

- [ ] **Step 5: score-sheet 加 safety fact 分支**

`src/lib/performance-score-sheet.ts` 找到 `computeFactDimensionScore` 或各维度分支（defect/ticket 已有）。safety 现因 `dataSource` 改 `fact`（T3 Step5 已改），会落入 fact 分支但无处理 → 返回 0。加：

```ts
case 'performance.safety-contribution': {
  // 从 PerformanceFact 读该员工该维度事实，sum(score) 受 cap(12)
  const facts = await prisma.performanceFact.findMany({ where: { year, employeeNo, dimensionCode: 'performance.safety-contribution' }});
  const raw = facts.reduce((s, f) => s + Number(f.score), 0);
  return { score: Math.min(raw, 12), facts };
}
```

（精确分支结构以文件现有 defect/ticket 分支为模板。）

- [ ] **Step 6: CLI 支持 safety 文件**

`scripts/import-facts-pipeline.ts` 加 safety 文件参数（如 `--safety=2024年突出贡献奖明细表.xlsx`），传入 `runImportPipeline({ ..., safety })`。

- [ ] **Step 7: 测试 + typecheck + commit**

Run: `pnpm test` → PASS。`pnpm tsc --noEmit` → 无错误。
```bash
git add src/lib/fact-import-persistence.ts src/lib/fact-import-persistence.test.ts src/lib/import-pipeline.ts src/lib/performance-score-sheet.ts scripts/import-facts-pipeline.ts
git commit -m "feat(safety): wire into import pipeline + score-sheet fact branch"
```

---

# Phase 5 — 集成收尾

### Task 9: 种子灌库 + 端到端校验 + 现有测试回归

**Files:**
- Run: `scripts/seed-scoring-rules.ts`
- Run: 端到端导入验证
- 验证：所有 `src/lib/*.test.ts` 通过

- [ ] **Step 1: 灌库 6 条规则**

```bash
npx tsx scripts/seed-scoring-rules.ts
```
Expected: 6 条 ScoringRule 写入（3 basic + defect + ticket + safety）。用 `prisma studio` 或 SQL 抽查 `SELECT "dimensionCode", "ruleType", config FROM "ScoringRule";` 确认。

- [ ] **Step 2: 端到端导入 4 个文件**

```bash
npx tsx scripts/import-facts-pipeline.ts \
  --year 2024 \
  --basic '《基本素质信息》.xlsx' \
  --ticket '《工作现场-两票执行》.xlsx' \
  --defect '《工作现场-缺陷治理》.xlsx' \
  --safety '2024年突出贡献奖明细表.xlsx'
```
Expected: 4 个维度导入成功，safety 进 ~115 条事实、94 员工（与前期实测一致）。

- [ ] **Step 3: 回归全部单元测试**

Run: `pnpm test`
Expected: 所有 `src/lib/*.test.ts` PASS（basic-quality/defect-governance/ticket-execution/safety-contribution/scoring-engine/scoring-standards 等）。

- [ ] **Step 4: typecheck 全量**

Run: `pnpm tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 最终 commit**

```bash
git add -A
git commit -m "chore(scoring): seed rules + end-to-end import verification"
```

---

### Task 10: 评分规则管理 UI 补全（BASIC_TIER 编辑器 + 两票单价表编辑器）

> **来源**：Task 1 code review 发现的下游缺口。`src/app/admin/scoring/page.tsx` 当前只支持 MATRIX/SHARE/NORMALIZE 三种规则的 UI 编辑，无 BASIC_TIER 入口，两票单价表（方案 A 的 `ticketPrices`）也无编辑界面。本任务让管理员能在 UI 完整管理 6 条规则。

**Files:**
- Modify: `src/app/admin/scoring/page.tsx` (RULE_TYPES 下拉、ConfigEditor 映射、新增 BasicTierEditor + TicketPriceEditor 组件)

- [ ] **Step 1: 读现状**

读 `src/app/admin/scoring/page.tsx`，定位：(a) `ruleType` 联合类型声明（约 line 20/29）；(b) RULE_TYPES 下拉选项（约 line 44-48）；(c) `ConfigEditor` 按 ruleType 分发的 map（约 line 270-274）。

- [ ] **Step 2: 扩展 ruleType 联合 + 下拉**

`ruleType` 类型加 `'BASIC_TIER'`。RULE_TYPES 下拉加 `{ value: 'BASIC_TIER', label: '档位映射（基本素质）' }`。

- [ ] **Step 3: 新增 BasicTierEditor 组件**

在 ConfigEditor map 加 `'BASIC_TIER': <BasicTierEditor .../>`。组件编辑 `tiers`（键值对列表：档位名 + 分数，支持增删行）+ `defaultScore`（数字输入）。参考现有 MatrixEditor 的键值对编辑模式。

- [ ] **Step 4: 新增 TicketPriceEditor 组件（两票方案 A）**

NORMALIZE 分支：检测 config 是否含 `ticketPrices`/`operationStepPrice`，若有则用 TicketPriceEditor（编辑 operationStepPrice + 三组 ticketPrices 表：workLeader/workPermitter/workMember，每组键值对）。若无则退化为现有 normalize 编辑器。

- [ ] **Step 5: 手测**

`pnpm dev` → 访问 `/admin/scoring` → 验证：6 条规则可加载、BASIC_TIER 规则可编辑 tiers、两票规则可编辑单价表、保存后 reload 数据正确。

- [ ] **Step 6: typecheck + commit**

Run: `pnpm tsc --noEmit` → 无错误（忽略 `import/page.tsx` 预存错误）。
```bash
git add src/app/admin/scoring/page.tsx
git commit -m "feat(admin/scoring): BASIC_TIER + ticket price editors in rule UI"
```

---

## Self-Review

**1. Spec coverage：**
- BASIC_TIER 引擎 → T1 ✅
- NORMALIZE 单价表 → T2 ✅
- 6 条规则种子 → T3 ✅
- 4 维度 parse/score 拆分 → T4/T5/T6/T7 ✅
- safety 去单位过滤 + 工号匹配 → T7 ✅
- safety 接入主链路（persist + pipeline + score-sheet）→ T8 ✅
- dataSource manual→fact → T3 Step5 ✅
- 端到端 → T9 ✅
- 非目标（路径 A 不改/手工维度不改/score-sheet 合并逻辑不改）→ 计划未触碰 ✅

**2. Placeholder scan：** 无 TBD/TODO。`persistSafetyFacts` 的 create 字段映射标注「以 schema 为准」——这是因为 `PerformanceFact` 字段多且需复核 @@unique 名，实现时读 schema 即可，非占位。`loadRule` helper 标注「若不存在则加」——属合理增量。

**3. Type consistency：** `tierValue`（BASIC_TIER）/ `ticketKind,steps,ticketType,workRole`（NORMALIZE）/ `level,incidentId`（MATRIX）/ `incidentId,faultCount`（SHARE）在引擎与解析器间一致。`scoredFacts` / `byEmployee` 在各 `scoreXxxFacts` 封装里统一。`computeFactScores` 返回结构以实际实现为准（各 Task Step 已标注「先读 scoring-engine.test.ts 确认」）。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-scoring-rules-to-db.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 派一个新 subagent 实现，Task 间我做两阶段 review，快速迭代。适合这种多 Task、有依赖链的改造。

**2. Inline Execution** — 在当前会话里用 executing-plans 批量执行，带 checkpoint 供你 review。

哪种？
