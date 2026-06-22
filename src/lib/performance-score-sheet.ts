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
import type { DeclarationTier } from '@/lib/quantitative-report';
import {
  inferDimensionCodeFromTitle,
  SCORING_STANDARDS,
  type DimensionScoringStandard,
  type ScoringDataSource,
} from '@/lib/scoring-standards';
import { levelFromHireDate, parseMockDeclarationTier } from '@/lib/declaration-level';

export type ScoreSource = 'FACT' | 'MANUAL' | 'NONE' | 'DEDUCTION';

export interface DimensionScoreLine {
  id?: string;
  label: string;
  score: number;
  detail?: string;
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
  /** @deprecated 两票已改为个人全年累加封顶，不再按能级比例折算 */
  ticketTierMaxRaw?: Partial<Record<DeclarationTier, number>>;
  /** 员工 profile.mockDeclarationTier 等模拟能级（申报前展示用） */
  mockDeclarationTier?: DeclarationTier | null;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function resolveTier(input: ScoreSheetInput): DeclarationTier | null {
  if (input.declarationTier) return input.declarationTier;
  if (input.mockDeclarationTier) return input.mockDeclarationTier;
  if (input.hireDate) return levelFromHireDate(input.hireDate) as DeclarationTier;
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

function perfFactsForDimension(
  facts: ScoreSheetInput['performanceFacts'],
  code: string,
) {
  return facts.filter((f) => f.dimensionCode === code);
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

function computeFactDimensionScore(
  standard: DimensionScoringStandard,
  input: ScoreSheetInput,
  perfFacts: ScoreSheetInput['performanceFacts'],
  basicFact?: ScoreSheetInput['basicFacts'][number],
): { score: number; lines: DimensionScoreLine[]; hasFacts: boolean } {
  if (standard.ruleType === 'BASIC_TIER' && basicFact) {
    const score = Number(basicFact.score);
    return {
      score,
      hasFacts: true,
      lines: [
        {
          id: basicFact.id,
          label: basicFact.tierValue,
          score,
          detail: basicFact.yearBreakdown ? JSON.stringify(basicFact.yearBreakdown) : undefined,
        },
      ],
    };
  }

  if (standard.code === 'worksite.defect-governance') {
    if (perfFacts.length === 0) {
      return { score: 0, lines: [], hasFacts: false };
    }
    const raw = perfFacts.reduce((s, f) => s + Number(f.score), 0);
    const score = round1(Math.min(raw, standard.maxScore));
    return {
      score,
      hasFacts: true,
      lines: perfFacts.map((f) => ({
        id: f.id,
        label: `${f.defectLevel ?? ''} ${f.defectRef ?? ''}`.trim(),
        score: Number(f.score),
        detail: f.role,
      })),
    };
  }

  if (standard.code === 'performance.safety-contribution') {
    // 安全贡献：系统导入维度（SHARE 计分后的 PerformanceFact，每人多条事件事实累加，封顶 maxScore）
    if (perfFacts.length === 0) {
      return { score: 0, lines: [], hasFacts: false };
    }
    const raw = perfFacts.reduce((s, f) => s + Number(f.score), 0);
    const score = round1(Math.min(raw, standard.maxScore));
    return {
      score,
      hasFacts: true,
      lines: perfFacts.map((f) => ({
        id: f.id,
        label: `${f.defectRef ?? ''} ${f.role ?? ''}`.trim(),
        score: Number(f.score),
        detail: f.role,
      })),
    };
  }

  if (standard.code === 'worksite.ticket-execution') {
    const agg = perfFacts[0];
    if (!agg) return { score: 0, lines: [], hasFacts: false };
    const raw = Number(agg.score);
    const meta = agg.metadata as { breakdown?: Record<string, number>; isRawScore?: boolean } | undefined;
    return {
      score: round1(raw),
      hasFacts: true,
      lines: [
        {
          id: agg.id,
          label: `原始分 ${raw}（最终折算在汇总阶段）`,
          score: round1(raw),
          detail: meta?.breakdown ? JSON.stringify(meta.breakdown) : undefined,
        },
      ],
    };
  }

  return { score: 0, lines: [], hasFacts: false };
}

function buildDimensionRow(
  standard: DimensionScoringStandard,
  input: ScoreSheetInput,
  itemByDimension: Map<string, TemplateItemLike>,
  subByItemId: Map<string, SubmissionItemLike>,
): DimensionScoreRow {
  const item = itemByDimension.get(standard.code);
  const sub = item ? subByItemId.get(item.id) : undefined;
  const basicFact = basicFactForDimension(input.basicFacts, standard.code);
  const perfFacts = perfFactsForDimension(input.performanceFacts, standard.code);
  const subFacts = submissionFactsForDimension(input.submissionFacts, standard.code);

  let score = 0;
  let source: ScoreSource = 'NONE';
  let lines: DimensionScoreLine[] = [];
  let hasImportedFacts = false;

  if (standard.dataSource === 'fact') {
    const computed = computeFactDimensionScore(standard, input, perfFacts, basicFact);
    if (computed.hasFacts) {
      score = computed.score;
      lines = computed.lines;
      source = 'FACT';
      hasImportedFacts = true;
    } else if (item && sub && !sub.isSystemFilled) {
      // 无导入事实时不应手工填 fact 维度；若员工误填则忽略
      score = 0;
      source = 'NONE';
    }
  } else if (standard.dataSource === 'deduction') {
    if (subFacts.length > 0) {
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
    && standard.code !== 'worksite.ticket-execution'
  ) {
    score = round1(Math.min(score, standard.maxScore));
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

  const activeStandards = SCORING_STANDARDS.filter((std) => {
    if (std.dataSource === 'fact') return true;
    if (itemByDimension.has(std.code)) return true;
    if (std.dataSource === 'deduction') {
      return input.templateItems.some((it) => /违章|扣分/.test(it.title));
    }
    return false;
  });

  const dimensionRows = activeStandards.filter((s) => s.dataSource !== 'deduction').map((std) =>
    buildDimensionRow(std, input, itemByDimension, subByItemId),
  );

  const deductionRows = activeStandards.filter((s) => s.dataSource === 'deduction').map((std) =>
    buildDimensionRow(std, input, itemByDimension, subByItemId),
  );

  const violationItem = input.templateItems.find((it) => /违章|扣分/.test(it.title));
  const mergedDeductionRows = violationItem
    ? (() => {
        const sub = subByItemId.get(violationItem.id);
        const score = computeManualItemScore(violationItem, sub);
        if (score >= 0) return [];
        return [
          {
            dimensionCode: 'special.violation',
            title: violationItem.title,
            sectionCode: 'special',
            sectionTitle: '特殊事项',
            maxScore: 0,
            score,
            source: 'DEDUCTION' as ScoreSource,
            dataSource: 'deduction' as ScoringDataSource,
            ruleType: 'DEDUCTION',
            ruleSummary: '安监部通报违章扣分',
            itemId: violationItem.id,
            hasImportedFacts: false,
            lines: [{ label: violationItem.title, score }],
          },
        ];
      })()
    : deductionRows.filter((r) => r.score !== 0);

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

/** 查询同年度各能级两票原始分最大值 */
export async function loadTicketTierMaxRaw(
  prisma: PrismaClient,
  year: number,
): Promise<Partial<Record<DeclarationTier, number>>> {
  const facts = await prisma.performanceFact.findMany({
    where: { year, dimensionCode: 'worksite.ticket-execution' },
    select: { score: true, employeeNo: true },
  });
  if (facts.length === 0) return {};

  const users = await prisma.user.findMany({
    where: { employeeNo: { in: facts.map((f) => f.employeeNo) } },
    select: { employeeNo: true, hireDate: true },
  });
  const hireByNo = new Map(users.map((u) => [u.employeeNo!, u.hireDate]));

  const max: Partial<Record<DeclarationTier, number>> = {};
  for (const f of facts) {
    const hire = hireByNo.get(f.employeeNo);
    const tier = (hire ? levelFromHireDate(hire) : '一级') as DeclarationTier;
    const raw = Number(f.score);
    if (!max[tier] || raw > max[tier]!) max[tier] = raw;
  }
  return max;
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

  const [basicFacts, performanceFacts, submissionFacts, ticketTierMaxRaw] = await Promise.all([
    prisma.employeeBasicFact.findMany({ where: { year, employeeNo: user.employeeNo } }),
    prisma.performanceFact.findMany({ where: { year, employeeNo: user.employeeNo } }),
    prisma.submissionDimensionFact.findMany({ where: { year, employeeNo: user.employeeNo } }),
    loadTicketTierMaxRaw(prisma, year),
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
    hireDate: user.hireDate,
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
    })),
    submissionFacts: submissionFacts.map((f) => ({
      id: f.id,
      dimensionCode: f.dimensionCode,
      label: f.label,
      score: Number(f.score),
      count: f.count,
      unitScore: Number(f.unitScore),
    })),
    ticketTierMaxRaw,
  });
}

/** 将分表维度得分同步到申报项（系统填充项得分） — 见 system-filled-items.ts */
export { scoreSheetToItemScores } from '@/lib/system-filled-items';

export { isBasicDimensionCode, BASIC_DIMENSION_TO_CODE };
