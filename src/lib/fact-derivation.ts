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
  _context: DerivationContext,
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
function buildShareDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  _context: DerivationContext,
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
const DEFECT_ROLE_LABEL: Record<string, string> = {
  FIRST_DISCOVERER: '第一发现人',
  CO_DISCOVERER: '共同发现人',
  FIRST_HANDLER: '第一处理人',
  CO_HANDLER: '共同处理人',
};

function buildMatrixDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  _context: DerivationContext,
  code: string,
): Derivation {
  if (facts.length === 0) {
    return { ...base, steps: emptyFactsSteps() };
  }
  const standard = SCORING_STANDARD_BY_CODE[code]!;
  const matrix = (ruleConfigFor(code)?.matrix ?? {}) as Record<string, Record<string, number>>;
  const steps: DerivationStep[] = [];

  // 同一缺陷内同人兼发现+处理：取高（tieBreak MAX_PER_PERSON）
  // 引擎导入时按 (employeeNo, defectLevel) 取最高角色分落库；此处按 defectRef 分组，
  // 组内若出现多条且合计超过单角色最高值，则标注取高（防御性展示，正常同缺陷仅 1 条）。
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
  steps.push({ label: `小计原始分 ${round2(raw)}`, kind: 'subtotal' });

  if (standard.maxScore > 0 && raw >= standard.maxScore) {
    steps.push({ label: `封顶 ${standard.maxScore}`, kind: 'cap' });
  }
  return { ...base, steps };
}
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
function buildDeductionDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  _context: DerivationContext,
  _code: string,
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
function buildManualAggregateDerivation(
  base: Derivation,
  facts: DerivationInputFact[],
  _context: DerivationContext,
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

/** 模块私有：保留两位小数（区别于 dimension-aggregation 的 round1）。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
