/**
 * 绩效分表：按《评分标准 对应表》合并
 * - 有事实数据的维度 → 规则引擎 / 导入分
 * - 无事实数据的维度 → 申报表手工计分
 */
import type { BasicDimension, PrismaClient } from '@prisma/client';
import {
  BASIC_DIMENSION_TO_CODE,
  basicDimensionFromCode,
  isBasicDimensionCode,
} from '@/lib/basic-dimension-map';
import type { DeclarationTier } from '@/lib/declaration-level';
import {
  aggregateEmployeeDimensions,
  capToStandard,
  round1,
  sumTicketFactsByEmployee,
  type EmployeeDimensionTotals,
} from '@/lib/dimension-aggregation';
import {
  inferDimensionCodeFromTitle,
  SCORING_STANDARDS,
  sourceDimensionCodes,
  type DimensionScoringStandard,
  type ScoringDataSource,
} from '@/lib/scoring-standards';
import {
  effectiveHireDate,
  evaluationCutoffDate,
  levelFromHireDate,
  parseMockDeclarationTier,
} from '@/lib/declaration-level';
import { ticketSpecialtyFromWorkArea } from '@/lib/ticket-specialty';

export type ScoreSource = 'FACT' | 'MANUAL' | 'NONE' | 'DEDUCTION';

export interface DimensionScoreLine {
  id?: string;
  label: string;
  score: number;
  detail?: string;
  /** 实际导入的细分事实维度，用于导出三级事实明细。 */
  sourceDimensionCode?: string;
  sourceFile?: string | null;
}

export interface DimensionScoreRow {
  dimensionCode: string;
  title: string;
  sectionCode: string;
  sectionTitle: string;
  maxScore: number;
  score: number;
  source: ScoreSource;
  dataSource: ScoringDataSource;
  ruleType: string;
  ruleSummary: string;
  itemId?: string;
  hasImportedFacts: boolean;
  lines: DimensionScoreLine[];
}

export interface SectionScoreSheet {
  code: string;
  title: string;
  maxScore: number;
  score: number;
  items: DimensionScoreRow[];
}

export interface PerformanceScoreSheet {
  year: number;
  employeeNo: string;
  employeeName: string;
  declarationTier: DeclarationTier | null;
  positiveMaxScore: number;
  positiveScore: number;
  deductionScore: number;
  totalScore: number;
  sections: SectionScoreSheet[];
}

export interface TemplateItemLike {
  id: string;
  title: string;
  dimensionCode?: string | null;
  scoreMode?: string;
  maxScore?: number | null;
  scoreOptions?: unknown;
  maxSelections?: number;
}

export interface SubmissionItemLike {
  itemId: string;
  score: number | string;
  selected?: unknown;
  isSystemFilled?: boolean;
  confirmationStatus?: string | null;
  overrideScore?: number | string | null;
}

export interface ScoreSheetInput {
  year: number;
  employeeNo: string;
  employeeName: string;
  declarationTier?: DeclarationTier | null;
  hireDate?: Date | null;
  templateItems: TemplateItemLike[];
  submissionItems?: SubmissionItemLike[];
  basicFacts: Array<{
    id: string;
    dimension: BasicDimension;
    tierValue: string;
    score: number | string;
    yearBreakdown?: unknown;
  }>;
  performanceFacts: Array<{
    id: string;
    dimensionCode: string;
    score: number | string;
    role?: string;
    defectRef?: string;
    defectLevel?: string;
    eventType?: string;
    metadata?: unknown;
    sourceFile?: string | null;
    recordKey?: string | null;
    recordType?: string | null;
    recordTitle?: string | null;
    participationRole?: string | null;
    sourceSheet?: string | null;
    sourceRowNo?: number | null;
  }>;
  /** L2 归档后落库的手工/扣分维度事实 */
  submissionFacts?: Array<{
    id: string;
    dimensionCode: string;
    label: string;
    score: number | string;
    count?: number;
    unitScore?: number | string;
  }>;
  /** 同一专业两票原始分最高值，用于按评分表折算到 30 分。 */
  ticketCohortMax?: number;
  /** 员工 profile.mockDeclarationTier 等模拟能级（申报前展示用） */
  mockDeclarationTier?: DeclarationTier | null;
  /** 年度评价工龄截止日；未传时沿用实时计算，兼容申报页面。 */
  evaluationDate?: Date;
}

function resolveTier(input: ScoreSheetInput): DeclarationTier | null {
  if (input.declarationTier) return input.declarationTier;
  if (input.mockDeclarationTier) return input.mockDeclarationTier;
  if (input.hireDate) return levelFromHireDate(input.hireDate, input.evaluationDate) as DeclarationTier;
  return '一级';
}

function resolveItemDimension(item: TemplateItemLike): string | null {
  if (item.dimensionCode) return item.dimensionCode;
  return inferDimensionCodeFromTitle(item.title);
}

function computeManualItemScore(
  item: TemplateItemLike,
  sub?: SubmissionItemLike,
): number {
  if (!sub) return 0;
  if (sub.overrideScore != null && sub.overrideScore !== '') {
    return Number(sub.overrideScore);
  }
  return Number(sub.score ?? 0);
}

function basicFactForDimension(
  facts: ScoreSheetInput['basicFacts'],
  code: string,
) {
  const dim = basicDimensionFromCode(code);
  if (!dim) return undefined;
  return facts.find((f) => f.dimension === dim);
}

function submissionFactsForDimension(
  facts: ScoreSheetInput['submissionFacts'],
  code: string,
) {
  return (facts ?? []).filter((f) => f.dimensionCode === code);
}

function sumSubmissionFactScore(facts: NonNullable<ScoreSheetInput['submissionFacts']>): number {
  return facts.reduce((sum, f) => sum + Number(f.score), 0);
}

const TICKET_CODE = 'worksite.ticket-execution';

/**
 * 为分表调用聚合时解析两票 cohort：
 * 旧分表在未传 ticketCohortMax 时用「本人原始分」当地最高，等价于折满。
 * 聚合在缺省时保留 raw——此处显式对齐旧分表金样。
 */
function resolveTicketCohortMaxForSheet(input: ScoreSheetInput): number | undefined {
  if (input.ticketCohortMax != null) return input.ticketCohortMax;
  const ticketFacts = input.performanceFacts.filter((f) => f.dimensionCode === TICKET_CODE);
  if (ticketFacts.length === 0) return undefined;
  return ticketFacts.reduce((sum, f) => sum + Number(f.score), 0);
}

/** 展示用明细行（不计分）；得分由维度聚合提供 */
function buildFactDimensionLines(
  standard: DimensionScoringStandard,
  input: ScoreSheetInput,
  perfFacts: ScoreSheetInput['performanceFacts'],
  basicFact: ScoreSheetInput['basicFacts'][number] | undefined,
  aggregatedScore: number,
): DimensionScoreLine[] {
  if (standard.ruleType === 'BASIC_TIER' && basicFact) {
    const tier = basicFact.tierValue.trim();
    if (!tier || tier === '//' || tier === '无') return [];
    return [
      {
        id: basicFact.id,
        label: tier,
        score: Number(basicFact.score),
        detail: basicFact.yearBreakdown ? JSON.stringify(basicFact.yearBreakdown) : undefined,
      },
    ];
  }

  if (standard.code === TICKET_CODE) {
    return perfFacts.map((fact) => ({
      id: fact.id,
      label: fact.recordTitle || fact.defectRef || standard.title,
      score: Number(fact.score),
      detail: fact.participationRole || fact.role,
      sourceDimensionCode: fact.dimensionCode,
      sourceFile: fact.sourceFile,
    }));
  }

  return perfFacts.map((fact) => ({
    id: fact.id,
    label:
      standard.code === 'worksite.defect-governance'
        ? `${fact.defectLevel ?? ''} ${fact.defectRef ?? ''}`.trim()
        : standard.code === 'performance.safety-contribution'
          ? `${fact.defectRef ?? ''} ${fact.role ?? ''}`.trim()
          : fact.defectRef || fact.eventType || standard.title,
    score: Number(fact.score),
    detail: fact.role,
    sourceDimensionCode: fact.dimensionCode,
    sourceFile: fact.sourceFile,
  }));
}

function buildDimensionRow(
  standard: DimensionScoringStandard,
  input: ScoreSheetInput,
  itemByDimension: Map<string, TemplateItemLike>,
  subByItemId: Map<string, SubmissionItemLike>,
  totals: EmployeeDimensionTotals,
): DimensionScoreRow {
  const item = itemByDimension.get(standard.code);
  const sub = item ? subByItemId.get(item.id) : undefined;
  const basicFact = basicFactForDimension(input.basicFacts, standard.code);
  const perfFacts = input.performanceFacts.filter((fact) =>
    sourceDimensionCodes(standard.code).includes(fact.dimensionCode),
  );
  const subFacts = submissionFactsForDimension(input.submissionFacts, standard.code);

  let score = 0;
  let source: ScoreSource = 'NONE';
  let lines: DimensionScoreLine[] = [];
  let hasImportedFacts = false;

  if (standard.dataSource === 'fact') {
    const dimTotal = totals.byCode[standard.code];
    if (dimTotal?.hasFacts) {
      // 导入事实维度总分：唯一权威来自维度聚合
      score = dimTotal.score;
      lines = buildFactDimensionLines(standard, input, perfFacts, basicFact, score);
      source = 'FACT';
      hasImportedFacts = true;
    } else if (item && sub && !sub.isSystemFilled) {
      // 无导入事实时，员工可按同一评分标准申报事实和分数，供一、二审确认。
      score = computeManualItemScore(item, sub);
      source = 'MANUAL';
      if (Array.isArray(sub.selected)) {
        lines = (sub.selected as Array<{ label?: string; score?: number; count?: number }>).map((s, index) => ({
          label: s.label ?? `员工申报事实 ${index + 1}`,
          score: Number(s.score ?? 0) * (s.count ?? 1),
        }));
      }
    }
  } else if (standard.dataSource === 'deduction') {
    if (perfFacts.length > 0) {
      score = perfFacts.reduce((sum, fact) => sum + Number(fact.score), 0);
      source = 'FACT';
      hasImportedFacts = true;
      lines = perfFacts.map((fact) => ({
        id: fact.id,
        label: fact.defectRef || fact.eventType || standard.title,
        score: Number(fact.score),
        detail: fact.role,
        sourceDimensionCode: fact.dimensionCode,
        sourceFile: fact.sourceFile,
      }));
    } else if (subFacts.length > 0) {
      score = sumSubmissionFactScore(subFacts);
      source = 'FACT';
      lines = subFacts.map((f) => ({
        id: f.id,
        label: f.label,
        score: Number(f.score),
      }));
    } else {
      score = item ? computeManualItemScore(item, sub) : 0;
      source = 'DEDUCTION';
      if (sub) {
        lines = [{ label: item?.title ?? standard.title, score }];
      }
    }
  } else {
    // manual
    if (subFacts.length > 0) {
      score = sumSubmissionFactScore(subFacts);
      source = 'FACT';
      lines = subFacts.map((f) => ({
        id: f.id,
        label: f.label,
        score: Number(f.score),
        detail: f.count && f.count > 1 ? `${f.count} 次` : undefined,
      }));
    } else if (item) {
      score = computeManualItemScore(item, sub);
      source = sub ? 'MANUAL' : 'NONE';
      if (sub && Array.isArray(sub.selected)) {
        lines = (sub.selected as Array<{ label?: string; score?: number; count?: number }>).map(
          (s, i) => ({
            label: s.label ?? `选项${i + 1}`,
            score: Number(s.score ?? 0) * (s.count ?? 1),
          }),
        );
      }
    }
  }

  if (
    standard.dataSource !== 'deduction'
    && standard.maxScore > 0
  ) {
    score = capToStandard(standard.code, score);
  }

  return {
    dimensionCode: standard.code,
    title: standard.title,
    sectionCode: standard.sectionCode,
    sectionTitle: standard.sectionTitle,
    maxScore: standard.maxScore,
    score,
    source,
    dataSource: standard.dataSource,
    ruleType: standard.ruleType,
    ruleSummary: standard.scoringSummary,
    itemId: item?.id,
    hasImportedFacts,
    lines,
  };
}

/** 纯函数：根据输入构建绩效分表 */
export function buildPerformanceScoreSheet(input: ScoreSheetInput): PerformanceScoreSheet {
  const itemByDimension = new Map<string, TemplateItemLike>();
  for (const item of input.templateItems) {
    const code = resolveItemDimension(item);
    if (code && !itemByDimension.has(code)) {
      itemByDimension.set(code, item);
    }
  }

  const subByItemId = new Map(
    (input.submissionItems ?? []).map((s) => [s.itemId, s]),
  );

  const totals = aggregateEmployeeDimensions({
    employeeNo: input.employeeNo,
    performanceFacts: input.performanceFacts.map((f) => ({
      dimensionCode: f.dimensionCode,
      score: f.score,
    })),
    basicFacts: input.basicFacts.map((f) => ({
      dimension: f.dimension,
      score: f.score,
      tierValue: f.tierValue,
    })),
    ticketCohortMax: resolveTicketCohortMaxForSheet(input),
  });

  const activeStandards = SCORING_STANDARDS.filter((std) => {
    if (std.dataSource === 'fact') return true;
    if (itemByDimension.has(std.code)) return true;
    if (std.dataSource === 'deduction') return input.performanceFacts.some((fact) =>
      sourceDimensionCodes(std.code).includes(fact.dimensionCode),
    ) || input.submissionFacts?.some((fact) => fact.dimensionCode === std.code) || input.templateItems.some((it) => /违章|扣分/.test(it.title));
    return false;
  });

  const dimensionRows = activeStandards.filter((s) => s.dataSource !== 'deduction').map((std) =>
    buildDimensionRow(std, input, itemByDimension, subByItemId, totals),
  );

  const deductionRows = activeStandards.filter((s) => s.dataSource === 'deduction').map((std) =>
    buildDimensionRow(std, input, itemByDimension, subByItemId, totals),
  );

  // 模板已定义的严重/一般违章即使当前为 0 分，也必须保留为系统确认项；
  // 否则员工无法对“无违章事实”提出申诉，11 个二级维度会缺项。
  const mergedDeductionRows = deductionRows.filter((row) => row.score !== 0 || row.itemId != null);

  const sectionMap = new Map<string, SectionScoreSheet>();
  for (const row of dimensionRows) {
    const sec =
      sectionMap.get(row.sectionCode) ??
      ({
        code: row.sectionCode,
        title: row.sectionTitle,
        maxScore: 0,
        score: 0,
        items: [],
      } satisfies SectionScoreSheet);
    sec.items.push(row);
    sec.maxScore += row.maxScore;
    sec.score += row.score;
    sectionMap.set(row.sectionCode, sec);
  }

  const sections = [...sectionMap.values()]
    .sort((a, b) => {
      const order = ['basic', 'performance', 'worksite'];
      return order.indexOf(a.code) - order.indexOf(b.code);
    })
    .map((s) => ({
      ...s,
      score: round1(s.score),
      maxScore: round1(s.maxScore),
    }));

  const positiveMaxScore = round1(
    activeStandards.filter((s) => s.dataSource !== 'deduction').reduce((n, s) => n + s.maxScore, 0),
  );
  const positiveScore = round1(sections.reduce((n, s) => n + s.score, 0));
  const deductionScore = round1(
    mergedDeductionRows.reduce((n, r) => n + Math.abs(Math.min(0, r.score)), 0),
  );

  if (mergedDeductionRows.length > 0) {
    sections.push({
      code: 'special',
      title: '特殊事项',
      maxScore: 0,
      score: round1(mergedDeductionRows.reduce((n, r) => n + r.score, 0)),
      items: mergedDeductionRows,
    });
  }

  return {
    year: input.year,
    employeeNo: input.employeeNo,
    employeeName: input.employeeName,
    declarationTier: resolveTier(input),
    positiveMaxScore,
    positiveScore,
    deductionScore,
    totalScore: round1(positiveScore - deductionScore),
    sections,
  };
}

/** 查询同一专业的两票原始最高分。 */
export async function loadTicketSpecialtyMaxRaw(
  prisma: Pick<PrismaClient, 'performanceFact' | 'user'>,
  year: number,
  workArea: string | null | undefined,
): Promise<number> {
  const facts = await prisma.performanceFact.findMany({
    where: { year, dimensionCode: 'worksite.ticket-execution' },
    select: { score: true, employeeNo: true },
  });
  if (facts.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { employeeNo: { in: facts.map((f) => f.employeeNo) } },
    select: { employeeNo: true, branch: { select: { name: true } } },
  });
  const specialty = ticketSpecialtyFromWorkArea(workArea);
  const specialtyByNo = new Map(
    users.map((u) => [u.employeeNo!, ticketSpecialtyFromWorkArea(u.branch?.name)]),
  );
  const rawByEmployee = sumTicketFactsByEmployee(facts);
  return Math.max(
    0,
    ...rawByEmployee
      .filter(({ employeeNo }) => specialtyByNo.get(employeeNo) === specialty)
      .map(({ rawTicketScore }) => rawTicketScore),
  );
}

export interface LoadScoreSheetParams {
  prisma: PrismaClient;
  year: number;
  employeeNo: string;
  templateId: string;
  userId?: string;
}

/** 从数据库加载并构建员工绩效分表 */
export async function loadPerformanceScoreSheet(
  params: LoadScoreSheetParams,
): Promise<PerformanceScoreSheet | null> {
  const { prisma, year, employeeNo, templateId, userId } = params;

  const user = await prisma.user.findFirst({
    where: userId ? { id: userId } : { employeeNo },
    select: {
      id: true,
      employeeNo: true,
      fullName: true,
      hireDate: true,
      profile: true,
      branch: { select: { name: true } },
    },
  });
  if (!user?.employeeNo) return null;

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    include: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  });
  if (!template) return null;

  const submission = await prisma.submission.findUnique({
    where: { userId_templateId: { userId: user.id, templateId } },
    include: {
      items: true,
      declarationLevel: { select: { name: true } },
    },
  });

  const [basicFacts, performanceFacts, submissionFacts, ticketCohortMax] = await Promise.all([
    prisma.employeeBasicFact.findMany({ where: { year, employeeNo: user.employeeNo } }),
    prisma.performanceFact.findMany({ where: { year, employeeNo: user.employeeNo } }),
    prisma.submissionDimensionFact.findMany({ where: { year, employeeNo: user.employeeNo } }),
    loadTicketSpecialtyMaxRaw(prisma, year, user.branch?.name),
  ]);

  const templateItems: TemplateItemLike[] = template.sections.flatMap((sec) =>
    sec.items.map((it) => ({
      id: it.id,
      title: it.title,
      dimensionCode: it.dimensionCode,
      scoreMode: it.scoreMode,
      maxScore: it.maxScore != null ? Number(it.maxScore) : null,
      scoreOptions: it.scoreOptions,
      maxSelections: it.maxSelections,
    })),
  );

  const declarationTier = submission?.declarationLevelName as DeclarationTier | undefined;

  return buildPerformanceScoreSheet({
    year,
    employeeNo: user.employeeNo,
    employeeName: user.fullName,
    declarationTier: declarationTier ?? null,
    mockDeclarationTier: parseMockDeclarationTier(user.profile),
    hireDate: effectiveHireDate(user.hireDate, user.profile),
    evaluationDate: evaluationCutoffDate(year),
    templateItems,
    submissionItems: submission?.items.map((it) => ({
      itemId: it.itemId,
      score: Number(it.score),
      selected: it.selected,
      isSystemFilled: it.isSystemFilled,
      confirmationStatus: it.confirmationStatus,
      overrideScore: it.overrideScore != null ? Number(it.overrideScore) : null,
    })),
    basicFacts: basicFacts.map((f) => ({
      id: f.id,
      dimension: f.dimension,
      tierValue: f.tierValue,
      score: Number(f.score),
      yearBreakdown: f.yearBreakdown,
    })),
    performanceFacts: performanceFacts.map((f) => ({
      id: f.id,
      dimensionCode: f.dimensionCode,
      score: Number(f.score),
      role: f.role,
      defectRef: f.defectRef,
      defectLevel: f.defectLevel,
      eventType: f.eventType,
      metadata: f.metadata,
      sourceFile: f.sourceFile,
      recordKey: f.recordKey,
      recordType: f.recordType,
      recordTitle: f.recordTitle,
      participationRole: f.participationRole,
      sourceSheet: f.sourceSheet,
      sourceRowNo: f.sourceRowNo,
    })),
    submissionFacts: submissionFacts.map((f) => ({
      id: f.id,
      dimensionCode: f.dimensionCode,
      label: f.label,
      score: Number(f.score),
      count: f.count,
      unitScore: Number(f.unitScore),
    })),
    ticketCohortMax,
  });
}

/** 将分表维度得分同步到申报项（系统填充项得分） — 见 system-filled-items.ts */
export { scoreSheetToItemScores } from '@/lib/system-filled-items';

export { isBasicDimensionCode, BASIC_DIMENSION_TO_CODE };
