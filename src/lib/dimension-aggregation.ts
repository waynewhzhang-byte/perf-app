/**
 * 维度聚合（Dimension Aggregation）
 *
 * 对已计分事实按维度求和、按 SCORING_STANDARDS.maxScore 封顶、
 * 按调用方指定的 cohort 做两票归一化。位于评分规则引擎之后、分表/报表之前。
 */
import { BASIC_DIMENSION_TO_CODE } from '@/lib/basic-dimension-map';
import {
  SCORING_STANDARD_BY_CODE,
  SCORING_STANDARDS,
  sourceDimensionCodes,
  type EvaluationDimensionCode,
} from '@/lib/scoring-standards';
import { round1 } from '@/lib/rounding';

export type TicketCohortKind = 'declarationLevel' | 'specialty';

const TICKET_CODE = 'worksite.ticket-execution';

/**
 * `round1` 曾经在本模块定义并被多处使用；现已集中到 `@/lib/rounding`。
 * 此处 re-export 以保持对外签名不变（其他模块可能已从本模块 import）。
 */
export { round1 };

/** 按评分标准封顶；无标准或 maxScore≤0 时只做 round1（扣分等） */
export function capToStandard(dimensionCode: string, rawScore: number): number {
  const standard = SCORING_STANDARD_BY_CODE[dimensionCode];
  if (!standard || standard.maxScore <= 0) return round1(rawScore);
  return round1(Math.min(rawScore, standard.maxScore));
}

/** 两个子分在共用满分下按比例封顶（报表列拆分用） */
export function cappedPair(first: number, second: number, cap: number): [number, number] {
  const total = first + second;
  if (total <= cap || total <= 0) return [round1(first), round1(second)];
  const firstCapped = round1((first / total) * cap);
  return [firstCapped, round1(cap - firstCapped)];
}

/** 组内归一化：raw / cohortMax × targetMax，再不超过 targetMax */
export function normalizeWithinCohort(
  raw: number,
  cohortMax: number,
  targetMax: number,
): number {
  if (cohortMax <= 0) return 0;
  return round1(Math.min(targetMax, (raw / cohortMax) * targetMax));
}

export function standardMaxScore(dimensionCode: string): number {
  return SCORING_STANDARD_BY_CODE[dimensionCode]?.maxScore ?? 0;
}

export interface AggregationPerformanceFact {
  dimensionCode: string;
  score: number | string;
}

export interface AggregationBasicFact {
  dimension: string;
  score: number | string;
  tierValue?: string;
}

export interface AggregateEmployeeInput {
  employeeNo: string;
  performanceFacts: AggregationPerformanceFact[];
  basicFacts?: AggregationBasicFact[];
  /**
   * 若提供，则对两票维度按 cohortMax 归一化到标准满分。
   * 批量场景下先不算票，再由 applyTicketCohortNormalization 二次写入。
   */
  ticketCohortMax?: number;
}

export interface DimensionTotal {
  dimensionCode: string;
  rawScore: number;
  /** 已按标准封顶；两票在未给 ticketCohortMax 时等于 rawScore */
  score: number;
  maxScore: number;
  factCount: number;
  hasFacts: boolean;
}

export interface EmployeeDimensionTotals {
  employeeNo: string;
  /** 精确维度码 + 父维度（sourceDimensionCodes 聚合） */
  byCode: Record<string, DimensionTotal>;
  rawTicketScore: number;
}

function emptyTotal(dimensionCode: string): DimensionTotal {
  return {
    dimensionCode,
    rawScore: 0,
    score: 0,
    maxScore: standardMaxScore(dimensionCode),
    factCount: 0,
    hasFacts: false,
  };
}

function isEmptyBasicTier(tierValue: string | undefined): boolean {
  if (tierValue === undefined) return false;
  const tier = tierValue.trim();
  return !tier || tier === '//' || tier === '无';
}

/**
 * 聚合单名员工的各维度原始合计与封顶分。
 * 两票：默认保留 raw；传入 ticketCohortMax 时按标准满分归一化。
 */
export function aggregateEmployeeDimensions(
  input: AggregateEmployeeInput,
): EmployeeDimensionTotals {
  const rawByCode = new Map<string, { raw: number; count: number }>();

  for (const fact of input.performanceFacts) {
    const cur = rawByCode.get(fact.dimensionCode) ?? { raw: 0, count: 0 };
    cur.raw += Number(fact.score);
    cur.count += 1;
    rawByCode.set(fact.dimensionCode, cur);
  }

  for (const fact of input.basicFacts ?? []) {
    if (isEmptyBasicTier(fact.tierValue)) continue;
    const code =
      BASIC_DIMENSION_TO_CODE[fact.dimension as keyof typeof BASIC_DIMENSION_TO_CODE] ??
      fact.dimension;
    const cur = rawByCode.get(code) ?? { raw: 0, count: 0 };
    cur.raw += Number(fact.score);
    cur.count += 1;
    rawByCode.set(code, cur);
  }

  const byCode: Record<string, DimensionTotal> = {};

  const ensureParentRollups = () => {
    for (const standard of SCORING_STANDARDS) {
      const sources = sourceDimensionCodes(standard.code);
      if (sources.length === 1 && sources[0] === standard.code) continue;
      let raw = 0;
      let count = 0;
      let any = false;
      for (const src of sources) {
        const row = rawByCode.get(src);
        if (!row) continue;
        any = true;
        raw += row.raw;
        count += row.count;
      }
      if (any) {
        rawByCode.set(standard.code, { raw, count });
      }
    }
  };
  ensureParentRollups();

  for (const [code, { raw, count }] of rawByCode) {
    const maxScore = standardMaxScore(code);
    let score: number;
    if (code === TICKET_CODE) {
      if (input.ticketCohortMax != null) {
        score = normalizeWithinCohort(raw, input.ticketCohortMax, maxScore || 30);
      } else {
        // 两票原始分保留精度，不做 round1（0.06 会被 round1 成 0.1）
        score = raw;
      }
    } else if (maxScore > 0) {
      score = capToStandard(code, raw);
    } else {
      score = round1(raw);
    }
    byCode[code] = {
      dimensionCode: code,
      rawScore: raw,
      score,
      maxScore,
      factCount: count,
      hasFacts: count > 0,
    };
  }

  const ticket = byCode[TICKET_CODE] ?? emptyTotal(TICKET_CODE);

  return {
    employeeNo: input.employeeNo,
    byCode,
    rawTicketScore: ticket.rawScore,
  };
}

export function dimensionScore(
  totals: EmployeeDimensionTotals,
  code: string,
): number {
  return totals.byCode[code]?.score ?? 0;
}

export function dimensionRaw(
  totals: EmployeeDimensionTotals,
  code: string,
): number {
  return totals.byCode[code]?.rawScore ?? 0;
}

export function dimensionFactCount(
  totals: EmployeeDimensionTotals,
  code: string,
): number {
  return totals.byCode[code]?.factCount ?? 0;
}

export interface TicketCohortRow {
  employeeNo: string;
  cohortKey: string;
  rawTicketScore: number;
}

export interface TicketNormalizedRow extends TicketCohortRow {
  ticketScore: number;
  ticketCohortMax: number;
}

/**
 * 批量两票归一化：按 cohortKey 分组取 max，再折算到两票标准满分。
 */
export function applyTicketCohortNormalization(
  rows: TicketCohortRow[],
  _cohortKind: TicketCohortKind,
): TicketNormalizedRow[] {
  const targetMax = standardMaxScore(TICKET_CODE) || 30;
  const maxByCohort = new Map<string, number>();
  for (const row of rows) {
    maxByCohort.set(
      row.cohortKey,
      Math.max(maxByCohort.get(row.cohortKey) ?? 0, row.rawTicketScore),
    );
  }
  return rows.map((row) => {
    const ticketCohortMax = maxByCohort.get(row.cohortKey) ?? 0;
    return {
      ...row,
      ticketCohortMax,
      ticketScore: normalizeWithinCohort(row.rawTicketScore, ticketCohortMax, targetMax),
    };
  });
}

/** 父维度满分（供报表 cappedPair） */
export function parentCap(code: EvaluationDimensionCode | string): number {
  return standardMaxScore(code);
}
