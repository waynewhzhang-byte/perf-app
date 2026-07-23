# 申报表单事实积分过程展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在员工申报填报页的系统计分项卡片上增加展开/折叠结构，展开后展示该维度的原始台账明细、计分规则、逐步积分过程，作为可追溯的证明材料。

**Architecture:** 新增纯函数模块 `src/lib/fact-derivation.ts`，按维度 ruleType 组装人类可读的逐步推导步骤（steps）。`/api/facts/route.ts` 在现有 item 上新增 `derivation` 字段（复用已加载的事实数据，无新增查询）。前端 `src/app/app/submission/[templateId]/page.tsx` 加 `expandedItems` 状态，按 ruleType 渲染三段式展开区。计分引擎逻辑零改动。

**Tech Stack:** TypeScript (strict)、Next.js 14 App Router、Tailwind CSS、node:test + tsx、Prisma（只读）。

**Spec:** `docs/superpowers/specs/2026-07-23-fact-derivation-display-design.md`

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `src/lib/fact-derivation.ts` | 纯函数：按 ruleType 组装 `Derivation`（steps + ruleSummary + rawFactFields）。不访问 DB，不计算得分。 | 新增 |
| `src/lib/fact-derivation.test.ts` | node:test 覆盖 5 种 ruleType + 无事实 + overrideScore + breakdown 缺失。 | 新增 |
| `src/app/api/facts/route.ts` | 每个 system item 增加 `derivation` 字段，调用 `buildDerivation`。 | 改造（约 102-166 行） |
| `src/app/app/submission/[templateId]/page.tsx` | `factsData` 类型加 `derivation`；加 `expandedItems` state；渲染三段式展开/折叠。 | 改造（约 68-93、580-718 行） |

不触碰：`scoring-engine.ts`、`performance-score-sheet.ts`、`system-filled-items.ts`、提交链路、DB schema。

---

## Task 1: 纯函数模块骨架与类型定义

建立 `fact-derivation.ts` 的类型契约和分派骨架。先定义类型，让后续 Task 有稳定的接口目标。

**Files:**
- Create: `src/lib/fact-derivation.ts`

- [ ] **Step 1: 创建模块，定义类型与骨架分派**

创建 `src/lib/fact-derivation.ts`：

```typescript
/**
 * 事实积分过程推导：把已计分的事实 + 评分标准 → 人类可读的逐步积分过程。
 *
 * 仅做"展示用文本组装"，不重新计算得分（得分来自计分引擎）。所有数字
 * 取自已落库的事实 / 标准常量，保证与服务器最终得分一致。
 */
import {
  SCORING_STANDARD_BY_CODE,
  defaultScoringRuleConfigs,
} from '@/lib/scoring-standards';

/** 单条推导步骤（前端按序渲染为流程节点）。 */
export interface DerivationStep {
  label: string;
  detail?: string;
  /** 渲染样式提示：原始分小计 / 封顶 / 最终 / 备注提示。 */
  kind?: 'raw' | 'subtotal' | 'cap' | 'final' | 'note';
}

/** 原始台账中每条事实的完整字段（复用 /api/facts 已返回的 facts[]）。 */
export interface DerivationFactField {
  id: string;
  label?: string;
  score: number;
  role?: string;
  defectRef?: string;
  defectLevel?: string;
  eventDate?: string | null;
  tierValue?: string;
  thirdLevelTitle?: string;
  metadata?: unknown;
  sourceFile?: string | null;
}

/** buildDerivation 的输入事实（与 DerivationFactField 同构）。 */
export type DerivationInputFact = DerivationFactField;

/** 某个维度展开后的完整证明材料。 */
export interface Derivation {
  ruleType: string;
  ruleSummary: string;
  referenceFile?: string;
  notes?: string;
  rawFactFields: DerivationFactField[];
  steps: DerivationStep[];
}

/** buildDerivation 运行时上下文（来自 score sheet 的派生值）。 */
export interface DerivationContext {
  /** 两票：同专业原始分最高值（折算基准）。 */
  ticketCohortMax?: number;
  /** 管理员改分：若存在，提示与原始推算的差异。 */
  overrideScore?: number | null;
  /** 该维度最终得分（来自 score sheet，用于"最终"步骤）。 */
  finalScore: number;
}

const RULE_CONFIG_BY_CODE: Record<string, { ruleType: string; config: Record<string, unknown> } | undefined> =
  Object.fromEntries(
    defaultScoringRuleConfigs().map((c) => [c.dimensionCode, { ruleType: c.ruleType, config: c.config }]),
  );

/** 取某维度的计分规则配置（matrix/ticketPrices/tiers 等）。 */
export function ruleConfigFor(dimensionCode: string): Record<string, unknown> | undefined {
  return RULE_CONFIG_BY_CODE[dimensionCode]?.config;
}

/**
 * 组装某个维度的积分过程证明材料。按 ruleType 分派到专用组装函数。
 *
 * 未匹配的维度（如 profile.hire-date）返回 null —— 调用方据此不渲染展开区。
 */
export function buildDerivation(
  dimensionCode: string,
  facts: DerivationInputFact[],
  context: DerivationContext,
): Derivation | null {
  const standard = SCORING_STANDARD_BY_CODE[dimensionCode];
  if (!standard) return null;

  const base: Derivation = {
    ruleType: standard.ruleType,
    ruleSummary: standard.scoringSummary,
    referenceFile: standard.referenceFile,
    notes: standard.notes,
    rawFactFields: facts,
    steps: [],
  };

  switch (standard.ruleType) {
    case 'BASIC_TIER':
      return buildBasicTierDerivation(base, facts, context, standard.code);
    case 'SHARE':
      return buildShareDerivation(base, facts, context, standard.code);
    case 'MATRIX_SUM':
      return buildMatrixDerivation(base, facts, context, standard.code);
    case 'NORMALIZE':
      return buildNormalizeDerivation(base, facts, context, standard.code);
    case 'DEDUCTION':
      return buildDeductionDerivation(base, facts, context, standard.code);
    case 'MANUAL_TIERS':
    case 'MANUAL_COUNTED':
      return buildManualAggregateDerivation(base, facts, context, standard.code);
    default:
      return null;
  }
}

// ── 专用组装函数（后续 Task 实现）──
function buildBasicTierDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  return { ...base, steps: [] };
}
function buildShareDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  return { ...base, steps: [] };
}
function buildMatrixDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  return { ...base, steps: [] };
}
function buildNormalizeDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  return { ...base, steps: [] };
}
function buildDeductionDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  return { ...base, steps: [] };
}
function buildManualAggregateDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  return { ...base, steps: [] };
}

/** overrideScore 与原始推算不一致时，前置一条诚实提示步骤。 */
export function overrideNotice(overrideScore: number, originalScore: number): DerivationStep | null {
  if (overrideScore === originalScore) return null;
  return {
    label: `该项得分已由审核员调整为 ${overrideScore} 分，以下积分过程为系统原始推算（${originalScore} 分），仅供参考`,
    kind: 'note',
  };
}

/** 无导入事实的统一兜底 steps。 */
export function emptyFactsSteps(): DerivationStep[] {
  return [{ label: '暂无导入事实，按 0 分计入', kind: 'note' }];
}
```

- [ ] **Step 2: 验证类型可编译**

Run: `npx tsx --eval "import('./src/lib/fact-derivation.ts')"`（或直接 `pnpm lint`）
Expected: 无类型错误（骨架函数返回空 steps 但类型完整）。

若 `pnpm lint` 因其他未提交改动报错，改用 `npx tsc --noEmit -p tsconfig.json 2>&1 | grep fact-derivation` 确认新文件无错。

- [ ] **Step 3: Commit**

```bash
git add src/lib/fact-derivation.ts
git commit -m "feat(derivation): add fact-derivation module skeleton with types"
```

---

## Task 2: BASIC_TIER 推导（技能/职称/绩效等级）

技能/职称/绩效等级：1 条 EmployeeBasicFact，档位查表。

**Files:**
- Modify: `src/lib/fact-derivation.ts`（替换 `buildBasicTierDerivation`）
- Test: `src/lib/fact-derivation.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/fact-derivation.test.ts`：

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDerivation, type DerivationInputFact } from './fact-derivation';

describe('buildDerivation — BASIC_TIER', () => {
  it('绩效等级：yearBreakdown 推导组合档位与得分', () => {
    const facts: DerivationInputFact[] = [
      {
        id: 'f1',
        tierValue: '1A2B',
        score: 5,
        label: '1A2B',
        yearBreakdown: { 2023: 'A', 2024: 'B', 2025: 'B' },
        thirdLevelTitle: '近三年绩效档位',
        sourceFile: '2.人员考核结果.xlsx',
      } as DerivationInputFact & { yearBreakdown: unknown },
    ];
    const d = buildDerivation('basic.performance-level', facts, { finalScore: 5 })!;
    assert.equal(d.ruleType, 'BASIC_TIER');
    assert.equal(d.steps.length, 2);
    assert.match(d.steps[0]!.label, /2023→A.*2024→B.*2025→B.*1A2B/);
    assert.equal(d.steps[1]!.label, '档位 1A2B → 5 分');
    assert.equal(d.referenceFile, '2.人员考核结果.xlsx');
  });

  it('技能等级：缺 yearBreakdown 时直接显示档位→得分', () => {
    const facts: DerivationInputFact[] = [
      { id: 'f1', tierValue: '技师', score: 3, sourceFile: '1.能级评价员工花名册.xlsx' },
    ];
    const d = buildDerivation('basic.skill-level', facts, { finalScore: 3 })!;
    assert.equal(d.steps.length, 1);
    assert.equal(d.steps[0]!.label, '档位 技师 → 3 分');
  });

  it('触顶时显示封顶步骤', () => {
    // 绩效等级 maxScore=6；构造一个等于上限的档位 3A(6分)
    const facts: DerivationInputFact[] = [
      { id: 'f1', tierValue: '3A', score: 6 },
    ];
    const d = buildDerivation('basic.performance-level', facts, { finalScore: 6 })!;
    const capStep = d.steps.find((s) => s.kind === 'cap');
    assert.equal(capStep?.label, '封顶 6');
  });

  it('无导入事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('basic.skill-level', [], { finalScore: 0 })!;
    assert.equal(d.steps.length, 1);
    assert.equal(d.steps[0]!.kind, 'note');
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: FAIL —— `steps.length` 为 0（骨架返回空数组），断言期望 2/1。

- [ ] **Step 3: 实现 buildBasicTierDerivation**

替换 `fact-derivation.ts` 中的 `buildBasicTierDerivation`：

```typescript
function buildBasicTierDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  if (facts.length === 0) {
    return { ...base, steps: emptyFactsSteps() };
  }
  const fact = facts[0]!;
  const standard = SCORING_STANDARD_BY_CODE[code]!;
  const steps: DerivationStep[] = [];

  // 绩效等级：展示近三年考核组合（yearBreakdown 存在时）
  if (code === 'basic.performance-level') {
    const yb = (fact as DerivationInputFact & { yearBreakdown?: Record<string, string> }).yearBreakdown;
    if (yb && typeof yb === 'object') {
      const years = Object.keys(yb).sort();
      if (years.length > 0) {
        const chain = years.map((y) => `${y}→${yb[y]}`).join('，');
        steps.push({
          label: `近三年考核：${chain} → 组合档位 ${fact.tierValue ?? ''}`.trim(),
        });
      }
    }
  }

  steps.push({ label: `档位 ${fact.tierValue ?? ''} → ${fact.score} 分` });

  // 触顶提示（BASIC_TIER 的档位分即最终分；仅当等于 maxScore 时标注封顶语义）
  if (standard.maxScore > 0 && fact.score >= standard.maxScore) {
    steps.push({ label: `封顶 ${standard.maxScore}`, kind: 'cap' });
  }

  return { ...base, steps };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: PASS（4 个测试全过）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fact-derivation.ts src/lib/fact-derivation.test.ts
git commit -m "feat(derivation): assemble BASIC_TIER derivation steps"
```

---

## Task 3: SHARE 推导（安全贡献）

安全贡献：多条事实按事件分组，第一发现人 3分/次、共同发现人合计 3 分均分。

**Files:**
- Modify: `src/lib/fact-derivation.ts`（替换 `buildShareDerivation`）
- Test: `src/lib/fact-derivation.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

在 `src/lib/fact-derivation.test.ts` 末尾追加：

```typescript
describe('buildDerivation — SHARE (安全贡献)', () => {
  it('按事件分组展示第一发现人/共同发现人均分', () => {
    const facts: DerivationInputFact[] = [
      { id: 'a', defectRef: 'AQ001', role: 'FIRST_DISCOVERER', score: 6, sourceFile: '3.突出贡献奖人员汇总.xlsx' },
      { id: 'b', defectRef: 'AQ002', role: 'CO_DISCOVERER', score: 1.5, sourceFile: '3.突出贡献奖人员汇总.xlsx' },
      { id: 'c', defectRef: 'AQ002', role: 'CO_DISCOVERER', score: 1.5, sourceFile: '3.突出贡献奖人员汇总.xlsx' },
    ];
    const d = buildDerivation('performance.safety-contribution', facts, { finalScore: 9 })!;
    assert.equal(d.ruleType, 'SHARE');
    // 第一发现人事件 + 两个共同发现人事件 + 小计
    const subtotals = d.steps.filter((s) => s.kind === 'subtotal');
    assert.equal(subtotals.length, 1);
    assert.match(subtotals[0]!.label, /小计原始分 9/);
    // 每条事实对应一行（reverse-engineer 6 = 3×2、1.5 = 3÷2）
    assert.ok(d.steps.some((s) => /AQ001.*3 分\/次.*× 2 次.*= 6/.test(s.label)));
    assert.ok(d.steps.some((s) => /AQ002.*均分.*3 ÷ 2 = 1\.5/.test(s.label)));
  });

  it('无事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('performance.safety-contribution', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: FAIL —— SHARE 测试报 `subtotals.length` 为 0。

- [ ] **Step 3: 实现 buildShareDerivation**

替换 `buildShareDerivation`：

```typescript
function buildShareDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  if (facts.length === 0) {
    return { ...base, steps: emptyFactsSteps() };
  }
  const standard = SCORING_STANDARD_BY_CODE[code]!;
  const steps: DerivationStep[] = [];

  // 按事件（defectRef）分组
  const byEvent = new Map<string, DerivationInputFact[]>();
  for (const f of facts) {
    const key = f.defectRef ?? '(未分组)';
    const arr = byEvent.get(key) ?? [];
    arr.push(f);
    byEvent.set(key, arr);
  }

  for (const [eventRef, group] of byEvent) {
    const first = group.filter((f) => f.role === 'FIRST_DISCOVERER');
    const co = group.filter((f) => f.role === 'CO_DISCOVERER');
    if (first.length > 0) {
      // 第一发现人：3 分/次 × 故障次数（score/3 反推次数）
      const perIncident = 3;
      const count = first.reduce((s, f) => s + f.score, 0) / perIncident;
      const total = first.reduce((s, f) => s + f.score, 0);
      steps.push({
        label: `事件 ${eventRef}：第一发现人 ${perIncident} 分/次 × ${count} 次故障 = ${round2(total)}`,
      });
    }
    if (co.length > 0) {
      // 共同发现人：合计 3 分/次 ÷ 人数；score 即每人所得
      const perPerson = co[0]!.score;
      const totalShare = round2(perPerson * co.length);
      steps.push({
        label: `事件 ${eventRef}：${co.length} 名共同发现人 均分 3 分/次 × 1 次故障 = ${totalShare} ÷ ${co.length} = ${round2(perPerson)}`,
      });
    }
  }

  const raw = facts.reduce((s, f) => s + f.score, 0);
  steps.push({ label: `小计原始分 ${round2(raw)}`, kind: 'subtotal' });

  if (standard.maxScore > 0 && raw >= standard.maxScore) {
    steps.push({ label: `封顶 ${standard.maxScore}`, kind: 'cap' });
  }
  return { ...base, steps };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

注：`round2` 为本模块私有辅助（区别于 dimension-aggregation 的 round1）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: PASS（全部测试，含 SHARE）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fact-derivation.ts src/lib/fact-derivation.test.ts
git commit -m "feat(derivation): assemble SHARE (safety contribution) derivation steps"
```

---

## Task 4: MATRIX_SUM 推导（缺陷治理）

缺陷治理：矩阵查表（角色×缺陷等级），同人兼发现+处理取高。

**Files:**
- Modify: `src/lib/fact-derivation.ts`（替换 `buildMatrixDerivation`）
- Test: `src/lib/fact-derivation.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/fact-derivation.test.ts`：

```typescript
describe('buildDerivation — MATRIX_SUM (缺陷治理)', () => {
  it('展示每条缺陷的矩阵查表得分', () => {
    const facts: DerivationInputFact[] = [
      { id: 'd1', defectRef: 'D001', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 3 },
      { id: 'd2', defectRef: 'D002', defectLevel: '一般', role: 'FIRST_DISCOVERER', score: 0.5 },
    ];
    const d = buildDerivation('worksite.defect-governance', facts, { finalScore: 3.5 })!;
    assert.equal(d.ruleType, 'MATRIX_SUM');
    assert.ok(d.steps.some((s) => /D001.*危急.*第一发现人.*矩阵查表 3/.test(s.label)));
    assert.ok(d.steps.some((s) => /D002.*一般.*第一发现人.*0\.5/.test(s.label)));
    assert.ok(d.steps.some((s) => /小计原始分 3\.5/.test(s.label)));
  });

  it('同缺陷多条事实且合计超过单条最高时触发取高提示', () => {
    // 引擎导入时按 (employeeNo, defectLevel) 取最高角色分落库；正常情况同缺陷只有 1 条。
    // 但若数据中同缺陷出现多条（如不同来源重复），且合计 > 单条最高，展示取高提示。
    const facts: DerivationInputFact[] = [
      { id: 'd1', defectRef: 'D001', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 3 },
      { id: 'd2', defectRef: 'D001', defectLevel: '严重', role: 'FIRST_HANDLER', score: 1 },
    ];
    const d = buildDerivation('worksite.defect-governance', facts, { finalScore: 4 })!;
    assert.ok(d.steps.some((s) => /同人 D001.*取高.*3/.test(s.label)), JSON.stringify(d.steps));
  });

  it('触顶显示封顶（maxScore=12）', () => {
    const facts: DerivationInputFact[] = [
      { id: 'd1', defectRef: 'D001', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 6 },
      { id: 'd2', defectRef: 'D002', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 6 },
    ];
    const d = buildDerivation('worksite.defect-governance', facts, { finalScore: 12 })!;
    assert.ok(d.steps.some((s) => s.kind === 'cap' && /封顶 12/.test(s.label)));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: FAIL —— MATRIX_SUM 测试报找不到匹配 label。

- [ ] **Step 3: 实现 buildMatrixDerivation**

替换 `buildMatrixDerivation`：

```typescript
const DEFECT_ROLE_LABEL: Record<string, string> = {
  FIRST_DISCOVERER: '第一发现人',
  CO_DISCOVERER: '共同发现人',
  FIRST_HANDLER: '第一处理人',
  CO_HANDLER: '共同处理人',
};

function buildMatrixDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  if (facts.length === 0) {
    return { ...base, steps: emptyFactsSteps() };
  }
  const standard = SCORING_STANDARD_BY_CODE[code]!;
  const matrix = (ruleConfigFor(code)?.matrix ?? {}) as Record<string, Record<string, number>>;
  const steps: DerivationStep[] = [];

  // 同一缺陷内同人兼发现+处理：取高（tieBreak MAX_PER_PERSON）
  // 此处按 defectRef 分组，组内若 sum 超过单角色最高值则标注取高
  const byDefect = new Map<string, DerivationInputFact[]>();
  for (const f of facts) {
    const key = f.defectRef ?? '(未编号)';
    const arr = byDefect.get(key) ?? [];
    arr.push(f);
    byDefect.set(key, arr);
  }

  for (const [ref, group] of byDefect) {
    for (const f of group) {
      const roleLabel = f.role ? DEFECT_ROLE_LABEL[f.role] ?? f.role : '';
      const matrixScore = matrix[f.defectLevel ?? '']?.[f.role ?? ''];
      const source = matrixScore != null ? `矩阵查表 ${matrixScore}` : `${f.score}`;
      steps.push({
        label: `缺陷 ${ref} ${f.defectLevel ?? ''} ${roleLabel} → ${source}`,
      });
    }
    // 同缺陷多角色（同人兼发现+处理）取高提示
    if (group.length > 1) {
      const max = Math.max(...group.map((f) => f.score));
      const sum = group.reduce((s, f) => s + f.score, 0);
      if (sum > max) {
        steps.push({ label: `同人 ${ref} 兼发现+处理，取高 → ${round2(max)}` });
      }
    }
  }

  const raw = facts.reduce((s, f) => s + f.score, 0);
  // 注：缺陷治理计分引擎对同人多角色已取高，此处 raw 为各 fact.score 之和（已取高后的值）
  steps.push({ label: `小计原始分 ${round2(raw)}`, kind: 'subtotal' });

  if (standard.maxScore > 0 && raw >= standard.maxScore) {
    steps.push({ label: `封顶 ${standard.maxScore}`, kind: 'cap' });
  }
  return { ...base, steps };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: PASS。

注：引擎导入时按 `(employeeNo, defectLevel)` 取最高角色分落库（见 `scoring-engine.ts:167` `processMatrix`），故同缺陷正常只有 1 条事实。"取高"推导步骤仅在数据中同缺陷出现多条且合计 > 单条最高时展示，作为防御性提示。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fact-derivation.ts src/lib/fact-derivation.test.ts
git commit -m "feat(derivation): assemble MATRIX_SUM (defect governance) derivation steps"
```

---

## Task 5: NORMALIZE 推导（两票执行，两段式）

两票执行：第一段从 breakdown 算原始分，第二段按专业最高折算到 30 分。

**Files:**
- Modify: `src/lib/fact-derivation.ts`（替换 `buildNormalizeDerivation`）
- Test: `src/lib/fact-derivation.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/fact-derivation.test.ts`：

```typescript
describe('buildDerivation — NORMALIZE (两票执行)', () => {
  it('两段式：breakdown→原始分，再按专业最高折算', () => {
    const facts: DerivationInputFact[] = [
      {
        id: 't1',
        score: 18.5,
        metadata: {
          isRawScore: true,
          breakdown: { operationItems: 150, operationPoints: 1.5, workLeaderPoints: 10, workPermitterPoints: 3, workMemberPoints: 4, operationTicketCount: 150, workTicketCount: 5 },
        },
        sourceFile: '10-13.两票数据汇总.xlsx',
      },
    ];
    const d = buildDerivation('worksite.ticket-execution', facts, { finalScore: 27.8, ticketCohortMax: 20 })!;
    assert.equal(d.ruleType, 'NORMALIZE');
    // 第一段：操作票项数 × 单价
    assert.ok(d.steps.some((s) => /操作票 150 项 × 0\.01 = 1\.5/.test(s.label)), JSON.stringify(d.steps));
    // 第一段：工作票负责人得分
    assert.ok(d.steps.some((s) => /工作票负责人.*10/.test(s.label)));
    // 原始分小计
    assert.ok(d.steps.some((s) => /原始分 18\.5/.test(s.label)));
    // 专业最高
    assert.ok(d.steps.some((s) => /专业最高原始分 20/.test(s.label)));
    // 第二段折算
    assert.ok(d.steps.some((s) => /18\.5 \/ 20 × 30 = 27\.75/.test(s.label)));
    // 最终（四舍五入）
    assert.ok(d.steps.some((s) => s.kind === 'final' && /27\.8.*四舍五入/.test(s.label)));
  });

  it('breakdown 缺失时聚合显示原始分并补注', () => {
    const facts: DerivationInputFact[] = [
      { id: 't1', score: 18.5, metadata: { isRawScore: true }, sourceFile: 'x.xlsx' },
    ];
    const d = buildDerivation('worksite.ticket-execution', facts, { finalScore: 27.8, ticketCohortMax: 20 })!;
    assert.ok(d.steps.some((s) => /原始分 18\.5/.test(s.label) && /明细未导入|聚合/.test(s.detail ?? s.label)));
  });

  it('无事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('worksite.ticket-execution', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: FAIL —— NORMALIZE 测试找不到匹配 label。

- [ ] **Step 3: 实现 buildNormalizeDerivation**

替换 `buildNormalizeDerivation`：

```typescript
interface TicketBreakdown {
  operationItems?: number;
  operationPoints?: number;
  workLeaderPoints?: number;
  workPermitterPoints?: number;
  workMemberPoints?: number;
  operationTicketCount?: number;
  workTicketCount?: number;
}

function buildNormalizeDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  if (facts.length === 0) {
    return { ...base, steps: emptyFactsSteps() };
  }
  const standard = SCORING_STANDARD_BY_CODE[code]!;
  const config = ruleConfigFor(code) ?? {};
  const operationStepPrice = (config.operationStepPrice as number | undefined) ?? 0.01;
  const targetMax = (config.targetMaxScore as number | undefined) ?? standard.maxScore;
  const agg = facts[0]!;
  const raw = agg.score;
  const meta = agg.metadata as { breakdown?: TicketBreakdown; isRawScore?: boolean } | undefined;
  const breakdown = meta?.breakdown;
  const cohortMax = context.ticketCohortMax ?? raw;
  const steps: DerivationStep[] = [];

  // 第一段：原始分
  if (breakdown && (breakdown.operationItems ?? 0) > 0) {
    steps.push({
      label: `操作票 ${breakdown.operationItems} 项 × ${operationStepPrice} = ${round2(breakdown.operationPoints ?? breakdown.operationItems * operationStepPrice)}`,
    });
  }
  if (breakdown && (breakdown.workLeaderPoints ?? 0) > 0) {
    steps.push({ label: `工作票负责人得分 ${round2(breakdown.workLeaderPoints!)}` });
  }
  if (breakdown && (breakdown.workPermitterPoints ?? 0) > 0) {
    steps.push({ label: `工作票许可人得分 ${round2(breakdown.workPermitterPoints!)}` });
  }
  if (breakdown && (breakdown.workMemberPoints ?? 0) > 0) {
    steps.push({ label: `工作票班成员得分 ${round2(breakdown.workMemberPoints!)}` });
  }

  if (steps.length > 0) {
    steps.push({ label: `原始分 ${round2(raw)}`, kind: 'subtotal' });
  } else {
    // breakdown 缺失：聚合显示
    steps.push({ label: `原始分 ${round2(raw)}`, detail: '明细未导入（按聚合原始分展示）', kind: 'subtotal' });
  }

  // 第二段：专业折算
  steps.push({ label: `专业最高原始分 ${round2(cohortMax)}（同专业折算基准）` });
  const converted = cohortMax > 0 ? round2((raw / cohortMax) * targetMax) : 0;
  steps.push({ label: `${round2(raw)} / ${round2(cohortMax)} × ${targetMax} = ${converted}` });

  // 最终（四舍五入）
  steps.push({ label: `最终得分 ${context.finalScore} 分（四舍五入）`, kind: 'final' });

  if (converted >= targetMax) {
    // 在最终前插入封顶（若折算触顶）
    steps.splice(steps.length - 1, 0, { label: `封顶 ${targetMax}`, kind: 'cap' });
  }
  return { ...base, steps };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fact-derivation.ts src/lib/fact-derivation.test.ts
git commit -m "feat(derivation): assemble NORMALIZE (ticket) two-stage derivation steps"
```

---

## Task 6: DEDUCTION 推导（违章扣分）

违章扣分：负值累加，不封顶。

**Files:**
- Modify: `src/lib/fact-derivation.ts`（替换 `buildDeductionDerivation`）
- Test: `src/lib/fact-derivation.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/fact-derivation.test.ts`：

```typescript
describe('buildDerivation — DEDUCTION (违章扣分)', () => {
  it('展示每条违章扣分并累加', () => {
    const facts: DerivationInputFact[] = [
      { id: 'v1', defectRef: 'Z001', role: '直接责任人', score: -10 },
      { id: 'v2', defectRef: 'Z002', role: '连带责任人', score: -5 },
    ];
    const d = buildDerivation('special.violation-severe', facts, { finalScore: -15 })!;
    assert.equal(d.ruleType, 'DEDUCTION');
    assert.ok(d.steps.some((s) => /Z001.*直接责任人.*-10/.test(s.label)));
    assert.ok(d.steps.some((s) => /Z002.*连带责任人.*-5/.test(s.label)));
    assert.ok(d.steps.some((s) => s.kind === 'subtotal' && /小计 -15/.test(s.label)));
    // 扣分不封顶：无 cap 步骤
    assert.equal(d.steps.find((s) => s.kind === 'cap'), undefined);
  });

  it('无违章事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('special.violation-severe', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: FAIL —— DEDUCTION 测试找不到匹配。

- [ ] **Step 3: 实现 buildDeductionDerivation**

替换 `buildDeductionDerivation`：

```typescript
function buildDeductionDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  if (facts.length === 0) {
    return { ...base, steps: emptyFactsSteps() };
  }
  const steps: DerivationStep[] = [];
  for (const f of facts) {
    const ref = f.defectRef ?? '(未编号)';
    const role = f.role ?? '责任人';
    steps.push({ label: `违章 ${ref} · ${role} → ${round2(f.score)}` });
  }
  const total = facts.reduce((s, f) => s + f.score, 0);
  steps.push({ label: `小计 ${round2(total)}`, kind: 'subtotal' });
  // 扣分维度不封顶（capToStandard 在 maxScore<=0 时只 round1）
  return { ...base, steps };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fact-derivation.ts src/lib/fact-derivation.test.ts
git commit -m "feat(derivation): assemble DEDUCTION (violation) derivation steps"
```

---

## Task 7: MANUAL_TIERS / MANUAL_COUNTED 推导（技术贡献/竞赛/创新）

这几个维度引擎不重算，单条 fact.score 已是导入时算好的；展开只做"明细 + 汇总"。

**Files:**
- Modify: `src/lib/fact-derivation.ts`（替换 `buildManualAggregateDerivation`）
- Test: `src/lib/fact-derivation.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/fact-derivation.test.ts`：

```typescript
describe('buildDerivation — MANUAL (技术贡献/竞赛/创新)', () => {
  it('技术贡献：按细分维度汇总并封顶', () => {
    const facts: DerivationInputFact[] = [
      { id: 'x1', thirdLevelTitle: '教材/题库/课件开发', label: '教材', score: 6 },
      { id: 'x2', thirdLevelTitle: '运规编写/会审', label: '运规', score: 2 },
    ];
    const d = buildDerivation('performance.technical-contribution', facts, { finalScore: 8 })!;
    assert.ok(d.steps.some((s) => /教材\/题库\/课件开发.*6/.test(s.label)));
    assert.ok(d.steps.some((s) => /运规编写\/会审.*2/.test(s.label)));
    assert.ok(d.steps.some((s) => s.kind === 'subtotal' && /小计 8/.test(s.label)));
  });

  it('触顶显示封顶 12', () => {
    const facts: DerivationInputFact[] = [
      { id: 'x1', thirdLevelTitle: '教材/题库/课件开发', score: 8 },
      { id: 'x2', thirdLevelTitle: '运规编写/会审', score: 6 },
    ];
    const d = buildDerivation('performance.technical-contribution', facts, { finalScore: 12 })!;
    assert.ok(d.steps.some((s) => s.kind === 'cap' && /封顶 12/.test(s.label)));
  });

  it('无事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('performance.competition', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: FAIL —— MANUAL 测试找不到匹配。

- [ ] **Step 3: 实现 buildManualAggregateDerivation**

替换 `buildManualAggregateDerivation`：

```typescript
function buildManualAggregateDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  context: DerivationContext,
  code: string,
): Derivation {
  if (facts.length === 0) {
    return { ...base, steps: emptyFactsSteps() };
  }
  const standard = SCORING_STANDARD_BY_CODE[code]!;
  const steps: DerivationStep[] = [];

  // 按细分维度（thirdLevelTitle）汇总
  const bySub = new Map<string, number>();
  for (const f of facts) {
    const key = f.thirdLevelTitle ?? f.label ?? '导入事实';
    bySub.set(key, (bySub.get(key) ?? 0) + f.score);
  }
  for (const [sub, score] of bySub) {
    steps.push({ label: `${sub} → ${round2(score)}` });
  }

  const raw = facts.reduce((s, f) => s + f.score, 0);
  steps.push({ label: `小计 ${round2(raw)}`, kind: 'subtotal' });

  if (standard.maxScore > 0 && raw >= standard.maxScore) {
    steps.push({ label: `封顶 ${standard.maxScore}`, kind: 'cap' });
  }
  return { ...base, steps };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: PASS（全部测试，所有 ruleType 覆盖）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fact-derivation.ts src/lib/fact-derivation.test.ts
git commit -m "feat(derivation): assemble MANUAL_TIERS/MANUAL_COUNTED aggregation steps"
```

---

## Task 8: overrideScore 诚实提示与全量回归

在所有 ruleType 实现后，补充 overrideScore 场景，并运行全量测试。

**Files:**
- Modify: `src/lib/fact-derivation.test.ts`（追加 overrideScore 测试）

- [ ] **Step 1: 写 overrideScore 测试**

追加到 `src/lib/fact-derivation.test.ts`：

```typescript
describe('buildDerivation — overrideScore 提示', () => {
  it('overrideScore 与原始推算不一致时前置提示', () => {
    const facts: DerivationInputFact[] = [
      { id: 's1', tierValue: '技师', score: 3 },
    ];
    // 系统原始推算 3 分，审核员改为 5 分
    const d = buildDerivation('basic.skill-level', facts, { finalScore: 5, overrideScore: 5 })!;
    const note = d.steps.find((s) => s.kind === 'note');
    assert.ok(note, '应包含 note 步骤');
    assert.match(note!.label, /审核员调整为 5 分.*原始推算.*3 分/);
    // note 在最前
    assert.equal(d.steps[0]!.kind, 'note');
  });

  it('overrideScore 与原始推算一致时不加提示', () => {
    const facts: DerivationInputFact[] = [
      { id: 's1', tierValue: '技师', score: 3 },
    ];
    const d = buildDerivation('basic.skill-level', facts, { finalScore: 3, overrideScore: 3 })!;
    assert.equal(d.steps.find((s) => s.kind === 'note'), undefined);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: FAIL —— overrideScore 测试找不到 note 步骤（buildDerivation 尚未接入 overrideNotice）。

- [ ] **Step 3: 在 buildDerivation 入口接入 overrideNotice**

修改 `src/lib/fact-derivation.ts` 的 `buildDerivation`，在分派返回后、return 前插入提示。将 `buildDerivation` 末尾的 switch 改为先计算 result 再前置 note：

```typescript
export function buildDerivation(
  dimensionCode: string,
  facts: DerivationInputFact[],
  context: DerivationContext,
): Derivation | null {
  const standard = SCORING_STANDARD_BY_CODE[dimensionCode];
  if (!standard) return null;

  const base: Derivation = {
    ruleType: standard.ruleType,
    ruleSummary: standard.scoringSummary,
    referenceFile: standard.referenceFile,
    notes: standard.notes,
    rawFactFields: facts,
    steps: [],
  };

  let result: Derivation;
  switch (standard.ruleType) {
    case 'BASIC_TIER':
      result = buildBasicTierDerivation(base, facts, context, standard.code);
      break;
    case 'SHARE':
      result = buildShareDerivation(base, facts, context, standard.code);
      break;
    case 'MATRIX_SUM':
      result = buildMatrixDerivation(base, facts, context, standard.code);
      break;
    case 'NORMALIZE':
      result = buildNormalizeDerivation(base, facts, context, standard.code);
      break;
    case 'DEDUCTION':
      result = buildDeductionDerivation(base, facts, context, standard.code);
      break;
    case 'MANUAL_TIERS':
    case 'MANUAL_COUNTED':
      result = buildManualAggregateDerivation(base, facts, context, standard.code);
      break;
    default:
      return null;
  }

  // overrideScore 与系统原始推算不一致时，前置诚实提示。
  // finalScore 可能已是 override 后的值，故对比维度是 overrideScore vs 原始聚合（来自 facts）。
  if (context.overrideScore != null) {
    const originalAggregate = computeOriginalAggregate(standard.code, facts, context);
    const notice = overrideNotice(context.overrideScore, originalAggregate);
    if (notice) {
      result = { ...result, steps: [notice, ...result.steps] };
    }
  }

  return result;
}

/** 计算"系统原始推算"得分（不含 override），用于 overrideNotice 对比。 */
function computeOriginalAggregate(code: string, facts: DerivationInputFact[], context: DerivationContext): number {
  const standard = SCORING_STANDARD_BY_CODE[code];
  if (!standard) return 0;
  if (facts.length === 0) return 0;
  if (standard.ruleType === 'NORMALIZE') {
    const raw = facts[0]!.score;
    const cohortMax = context.ticketCohortMax ?? raw;
    const targetMax = (ruleConfigFor(code)?.targetMaxScore as number | undefined) ?? standard.maxScore;
    return cohortMax > 0 ? round2((raw / cohortMax) * targetMax) : 0;
  }
  return round2(facts.reduce((s, f) => s + f.score, 0));
}
```

- [ ] **Step 4: 运行全量测试确认通过**

Run: `npx tsx --test src/lib/fact-derivation.test.ts`
Expected: PASS（所有 describe 全过）。

- [ ] **Step 5: 运行全仓测试确认无回归**

Run: `pnpm test`
Expected: PASS（fact-derivation 新增测试 + 现有 ~22 个 test 文件全过）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/fact-derivation.ts src/lib/fact-derivation.test.ts
git commit -m "feat(derivation): add overrideScore honesty notice and full regression"
```

---

## Task 9: /api/facts 路由接入 derivation

在 `/api/facts/route.ts` 每个 system item 上新增 `derivation` 字段。复用已加载的 `perfFacts`/`basicFacts`，无新增查询。

**Files:**
- Modify: `src/app/api/facts/route.ts`

- [ ] **Step 1: 读取当前 facts route 确认 facts 数组组装位置**

Run: `sed -n '100,166p' src/app/api/facts/route.ts`（已在 spec 探索中读过，确认 items.map 在 102-166 行，basic 分支 108-135，performance 分支 137-165）

- [ ] **Step 2: 添加 import 与 ticketCohortMax 加载**

在 `src/app/api/facts/route.ts` 顶部 import 区追加：

```typescript
import { buildDerivation, type DerivationInputFact } from '@/lib/fact-derivation';
import { loadTicketSpecialtyMaxRaw } from '@/lib/performance-score-sheet';
```

在 `loadPerformanceScoreSheet` 调用之后（约第 49 行后）、`extractSystemFilledFromSheet` 之前，加载 ticketCohortMax：

```typescript
  // 两票折算基准：同专业原始分最高值（仅两票维度需要）
  const userWithBranch = await prisma.user.findUnique({
    where: { id: s.userId },
    select: { branch: { select: { name: true } } },
  });
  const ticketCohortMax = await loadTicketSpecialtyMaxRaw(prisma, template.year, userWithBranch?.branch?.name);
```

注：原有第 58-61 行已查 user（取 employeeNo/hireDate/profile）。为减少查询，可将 branch 合并进该查询。**实现时把第 58-61 行的 select 扩展为 `select: { employeeNo: true, hireDate: true, profile: true, branch: { select: { name: true } } }`，并用同一变量，避免重复查询。**

- [ ] **Step 3: 在 items.map 中为每个 item 组装 derivation**

在 `src/app/api/facts/route.ts` 的 `items.map`（102-166 行）内，basic 分支和 performance 分支的 return 对象中，各增加 `derivation` 字段。

basic 分支（108-135 行的 return）末尾增加：

```typescript
        derivation: buildDerivation(
          code,
          fact ? [{
            id: fact.id,
            tierValue: fact.tierValue,
            score: Number(fact.score),
            label: dim ? BASIC_DIMENSION_LABELS[dim] : code,
            thirdLevelTitle: sourceDimensionTitle(code),
            yearBreakdown: fact.yearBreakdown,
            sourceFile: fact.sourceFile,
          } as DerivationInputFact] : [],
          { finalScore: sys.score },
        ) ?? undefined,
```

performance 分支（137-165 行的 return）末尾增加：

```typescript
        derivation: buildDerivation(
          code,
          facts.map((f) => ({
            id: f.id,
            score: Number(f.score),
            role: f.role ?? undefined,
            defectRef: f.defectRef ?? undefined,
            defectLevel: f.defectLevel ?? undefined,
            eventDate: f.eventDate,
            label: f.dimensionTitle || f.dimensionCode,
            thirdLevelTitle: sourceDimensionTitle(f.dimensionCode),
            metadata: f.metadata,
            sourceFile: f.sourceFile,
          } satisfies DerivationInputFact),
          { finalScore: sys.score, ticketCohortMax },
        ) ?? undefined,
```

注意：`overrideScore` 暂不在此接入（填报页活引用当前事实，申报未提交时无 overrideScore；若已存在 submission 的 overrideScore 需展示，需额外查 SubmissionItem —— 本期 spec 范围为"仅填报页展示当前推算"，overrideScore 提示能力已在 fact-derivation 内置，留作后续接入点）。**实现时在代码注释标注此限制。**

- [ ] **Step 4: 验证 API 编译**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "facts/route|fact-derivation"`
Expected: 无输出（无类型错误）。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/facts/route.ts
git commit -m "feat(facts): attach derivation to each system-filled item"
```

---

## Task 10: 前端 factsData 类型加 derivation

更新申报页的 `factsData` TypeScript 类型，使其包含 `derivation` 字段（类型对齐后端）。先改类型，不动渲染（便于后续渲染 Task 独立验证）。

**Files:**
- Modify: `src/app/app/submission/[templateId]/page.tsx`（约 68-93 行）

- [ ] **Step 1: 扩展 factsData 类型**

在 `src/app/app/submission/[templateId]/page.tsx` 第 68-93 行的 `factsData` state 类型中，为每个 item 增加 `derivation` 可选字段。在 `facts: {...}[]` 之后、item 闭合 `}[]` 之前插入：

```typescript
      derivation?: {
        ruleType: string;
        ruleSummary: string;
        referenceFile?: string;
        notes?: string;
        rawFactFields: {
          id: string;
          label?: string;
          score: number;
          role?: string;
          defectRef?: string;
          defectLevel?: string;
          eventDate?: string | null;
          tierValue?: string;
          thirdLevelTitle?: string;
          metadata?: unknown;
          sourceFile?: string | null;
        }[];
        steps: { label: string; detail?: string; kind?: 'raw' | 'subtotal' | 'cap' | 'final' | 'note' }[];
      };
```

（插入位置：在现有 `facts: { ... }[];` 之后、`totalScore: number;` 之前或之后均可，保持与后端字段顺序一致即可。）

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep submission`
Expected: 无输出（类型对齐）。

- [ ] **Step 3: Commit**

```bash
git add src/app/app/submission/[templateId]/page.tsx
git commit -m "feat(submission): add derivation type to factsData"
```

---

## Task 11: 前端展开/折叠状态与触发按钮

加 `expandedItems` state，并在每个系统计分项卡片底部加展开/折叠触发按钮。此 Task 只做交互骨架，不渲染三段式内容（下一 Task）。

**Files:**
- Modify: `src/app/app/submission/[templateId]/page.tsx`

- [ ] **Step 1: 加 expandedItems state**

在 `src/app/app/submission/[templateId]/page.tsx` 现有 `factsAttachments` state（约第 97 行）之后追加：

```typescript
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const toggleExpand = (itemId: string) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
```

- [ ] **Step 2: 在卡片内加展开触发按钮**

在系统自动填充项渲染区（约第 645 行 `</div>` 闭合三级事实列表的 `div` 之后、第 647 行 `{!confirmed && !disputed &&` 之前），插入展开按钮区块。该按钮仅在 item 有 `derivation` 且非 profile 时显示：

```typescript
                    {fi.derivation && fi.factKind !== 'profile' && (
                      <div className="mt-2 border-t border-slate-100 pt-2">
                        <button
                          type="button"
                          onClick={() => toggleExpand(fi.itemId)}
                          className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 cursor-pointer"
                        >
                          {expandedItems.has(fi.itemId) ? '▴ 收起' : '▾ 展开原始数据与积分过程'}
                        </button>
                      </div>
                    )}
```

- [ ] **Step 3: 验证 lint + build**

Run: `pnpm lint`
Expected: PASS。

Run: `pnpm build`
Expected: PASS（编译成功）。

- [ ] **Step 4: Commit**

```bash
git add src/app/app/submission/[templateId]/page.tsx
git commit -m "feat(submission): add expand/collapse toggle for system-filled items"
```

---

## Task 12: 前端三段式展开内容渲染

实现展开区的三段式内容：原始台账明细 / 计分规则 / 积分过程。按 `expandedItems` 条件渲染。

**Files:**
- Modify: `src/app/app/submission/[templateId]/page.tsx`

- [ ] **Step 1: 在展开按钮区块后插入三段式渲染**

在 Task 11 插入的展开按钮 `</div>` 之后、第 647 行确认/申诉按钮之前，插入条件渲染的三段式区块。仅当 `expandedItems.has(fi.itemId)` 且有 `derivation` 时渲染：

```typescript
                    {fi.derivation && expandedItems.has(fi.itemId) && (
                      <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                        {/* overrideScore 诚实提示（note 步骤置顶） */}
                        {fi.derivation.steps.filter((s) => s.kind === 'note').map((s, i) => (
                          <p key={`note-${i}`} className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800">
                            ⚠ {s.label}
                          </p>
                        ))}

                        {/* 1. 原始台账明细 */}
                        <div>
                          <p className="text-xs font-semibold text-slate-600">原始台账明细</p>
                          <div className="mt-1 space-y-0.5">
                            {fi.derivation.rawFactFields.length === 0 ? (
                              <p className="text-xs text-slate-400">暂无导入事实</p>
                            ) : (
                              fi.derivation.rawFactFields.map((rf) => (
                                <p key={rf.id} className="text-xs text-slate-500">
                                  {rf.thirdLevelTitle && <span className="font-medium">{rf.thirdLevelTitle}</span>}
                                  {rf.defectLevel && ` · ${rf.defectLevel}`}
                                  {rf.defectRef && ` · ${rf.defectRef}`}
                                  {rf.role && ` · ${rf.role}`}
                                  {rf.tierValue && ` · 档位 ${rf.tierValue}`}
                                  {rf.eventDate && ` · ${String(rf.eventDate).slice(0, 10)}`}
                                  {' → '}<b>{rf.score} 分</b>
                                  {rf.sourceFile && <span className="text-slate-400"> · 来源：{rf.sourceFile}</span>}
                                </p>
                              ))
                            )}
                          </div>
                        </div>

                        {/* 2. 计分规则 */}
                        <div className="border-t border-slate-200 pt-2">
                          <p className="text-xs font-semibold text-slate-600">计分规则</p>
                          <p className="mt-0.5 text-xs text-slate-500">{fi.derivation.ruleSummary}</p>
                          {fi.derivation.referenceFile && (
                            <p className="mt-0.5 text-xs text-slate-400">参考台账：{fi.derivation.referenceFile}</p>
                          )}
                          {fi.derivation.notes && (
                            <p className="mt-0.5 text-xs text-amber-700">备注：{fi.derivation.notes}</p>
                          )}
                        </div>

                        {/* 3. 积分过程 */}
                        <div className="border-t border-slate-200 pt-2">
                          <p className="text-xs font-semibold text-slate-600">积分过程</p>
                          <ol className="mt-1 space-y-1">
                            {fi.derivation.steps.filter((s) => s.kind !== 'note').map((s, i) => (
                              <li key={i} className={`flex items-start gap-2 text-xs ${
                                s.kind === 'final' ? 'font-semibold text-emerald-700' :
                                s.kind === 'cap' ? 'text-slate-600' :
                                s.kind === 'subtotal' ? 'text-slate-600' :
                                'text-slate-500'
                              }`}>
                                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-medium text-slate-600">
                                  {i + 1}
                                </span>
                                <span>
                                  {s.label}
                                  {s.detail && <span className="ml-1 text-slate-400">（{s.detail}）</span>}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    )}
```

- [ ] **Step 2: 验证 lint + build**

Run: `pnpm lint`
Expected: PASS。

Run: `pnpm build`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/app/app/submission/[templateId]/page.tsx
git commit -m "feat(submission): render three-section derivation panel on expand"
```

---

## Task 13: 全量验证与收尾

运行全量测试、lint、build，确认无回归。

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: PASS（含新增 fact-derivation.test.ts 全部用例 + 现有 22 个 test 文件）。

- [ ] **Step 2: lint**

Run: `pnpm lint`
Expected: PASS。

- [ ] **Step 3: build**

Run: `pnpm build`
Expected: PASS。

- [ ] **Step 4: 手动验证矩阵（需 dev 环境与数据）**

Run: `pnpm dev`，登录一个有导入事实的员工账号，打开申报填报页，逐项展开验证：
- [ ] 技能/职称/绩效等级（BASIC_TIER）：展开显示档位→得分，绩效等级含年度组合
- [ ] 安全贡献（SHARE）：展开显示事件分组、均分
- [ ] 缺陷治理（MATRIX_SUM）：展开显示矩阵查表、取高提示
- [ ] 两票执行（NORMALIZE）：展开显示两段式折算
- [ ] 违章扣分（DEDUCTION）：展开显示负值累加、无封顶
- [ ] 技术贡献/竞赛/创新（MANUAL）：展开显示细分汇总
- [ ] 无事实维度：展开显示"暂无导入事实"
- [ ] 参加工作时间项：无展开按钮（profile）
- [ ] 默认全部折叠；展开/收起切换正常
- [ ] 数字与 `/api/admin/import/scores` 批量结果对齐

- [ ] **Step 5: Commit（如有手动验证发现的小修）**

```bash
git add -A
git commit -m "fix(submission): polish derivation display per manual review"
```

（若手动验证无问题，此步可跳过。）
