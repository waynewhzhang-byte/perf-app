/**
 * 基于已导入基本素质和绩效事实批量计算绩效分表。
 * 规则与 buildPerformanceScoreSheet / 《评分标准 对应表》一致。
 */
import type { BasicDimension, PrismaClient } from '@prisma/client';
import {
  buildPerformanceScoreSheet,
  type PerformanceScoreSheet,
} from '@/lib/performance-score-sheet';
import { applyTicketCohortNormalization } from '@/lib/dimension-aggregation';
import { effectiveHireDate, evaluationCutoffDate, levelFromHireDate, parseMockDeclarationTier, type DeclarationTier } from '@/lib/declaration-level';
import { SCORING_STANDARDS, sourceDimensionCodes } from '@/lib/scoring-standards';
import { ticketSpecialtyFromWorkArea } from '@/lib/ticket-specialty';
import { round2 } from '@/lib/rounding';

// 导入事实既包含正向事实，也包含由台账导入的违章扣分事实。
// 两者都必须进入分表，才能使“特殊事项（扣分）”和最终积分一致。
const FACT_DIMENSION_CODES = SCORING_STANDARDS
  .filter((standard) => standard.dataSource === 'fact' || standard.dataSource === 'deduction')
  .flatMap((standard) => sourceDimensionCodes(standard.code));

export interface ImportedScoreRow {
  employeeNo: string;
  employeeName: string;
  gender: string | null;
  branchName: string | null;
  departmentName: string | null;
  workStartDate: Date | null;
  declarationTier: string | null;
  basicScore: number;
  basicMaxScore: number;
  worksiteScore: number;
  worksiteMaxScore: number;
  performanceScore: number;
  performanceMaxScore: number;
  safetyScore: number;
  technicalContributionScore: number;
  competitionScore: number;
  innovationScore: number;
  ticketScore: number;
  ticketMaxScore: number;
  defectScore: number;
  defectMaxScore: number;
  skillScore: number;
  titleScore: number;
  performanceLevelScore: number;
  importedTotalScore: number;
  importedMaxScore: number;
  deductionScore: number;
  finalTotalScore: number;
  ticketRawScore: number | null;
  defectRawScore: number | null;
  sheet?: PerformanceScoreSheet;
}

export interface BatchImportedScoresResult {
  year: number;
  ticketSpecialtyMaxRaw: Record<string, number>;
  /** @deprecated 改用 ticketSpecialtyMaxRaw；保留一版以兼容既有管理端自动化。 */
  ticketTierMaxRaw: Partial<Record<DeclarationTier, number>>;
  total: number;
  rows: ImportedScoreRow[];
}

function sectionScore(sheet: PerformanceScoreSheet, code: string) {
  const sec = sheet.sections.find((s) => s.code === code);
  return { score: sec?.score ?? 0, maxScore: sec?.maxScore ?? 0 };
}

function dimensionScore(sheet: PerformanceScoreSheet, dimensionCode: string) {
  for (const sec of sheet.sections) {
    const item = sec.items.find((i) => i.dimensionCode === dimensionCode);
    if (item) return { score: item.score, maxScore: item.maxScore };
  }
  return { score: 0, maxScore: 0 };
}

function toImportedScoreRow(
  employeeNo: string,
  employeeName: string,
  gender: string | null,
  branchName: string | null,
  departmentName: string | null,
  workStartDate: Date | null,
  sheet: PerformanceScoreSheet,
  ticketRaw: number | null,
  defectRaw: number | null,
): ImportedScoreRow {
  const basic = sectionScore(sheet, 'basic');
  const worksite = sectionScore(sheet, 'worksite');
  const performance = sectionScore(sheet, 'performance');
  const ticket = dimensionScore(sheet, 'worksite.ticket-execution');
  const defect = dimensionScore(sheet, 'worksite.defect-governance');
  const skill = dimensionScore(sheet, 'basic.skill-level');
  const title = dimensionScore(sheet, 'basic.title-level');
  const perf = dimensionScore(sheet, 'basic.performance-level');
  const safety = dimensionScore(sheet, 'performance.safety-contribution');
  const technical = dimensionScore(sheet, 'performance.technical-contribution');
  const competition = dimensionScore(sheet, 'performance.competition');
  const innovation = dimensionScore(sheet, 'performance.innovation');

  return {
    employeeNo,
    employeeName,
    gender,
    branchName,
    departmentName,
    workStartDate,
    declarationTier: sheet.declarationTier,
    basicScore: basic.score,
    basicMaxScore: basic.maxScore,
    worksiteScore: worksite.score,
    worksiteMaxScore: worksite.maxScore,
    performanceScore: performance.score,
    performanceMaxScore: performance.maxScore,
    safetyScore: safety.score,
    technicalContributionScore: technical.score,
    competitionScore: competition.score,
    innovationScore: innovation.score,
    ticketScore: ticket.score,
    ticketMaxScore: ticket.maxScore,
    defectScore: defect.score,
    defectMaxScore: defect.maxScore,
    skillScore: skill.score,
    titleScore: title.score,
    performanceLevelScore: perf.score,
    importedTotalScore: sheet.positiveScore,
    importedMaxScore: sheet.positiveMaxScore,
    deductionScore: sheet.deductionScore,
    finalTotalScore: sheet.totalScore,
    ticketRawScore: ticketRaw,
    defectRawScore: defectRaw,
    sheet,
  };
}

export interface BatchImportedScoresOptions {
  /** 精确匹配员工工号 */
  employeeNo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  /** 拉取全部员工（忽略 pageSize 上限，仅 CLI/导出用） */
  fetchAll?: boolean;
  /** 仅返回有基本素质事实的员工（默认 true） */
  requireBasic?: boolean;
  /** 是否附带完整 sheet（列表接口建议 false） */
  includeSheet?: boolean;
}

/** 批量计算指定年度、基于导入事实的绩效分表 */
export async function batchComputeImportedScores(
  prisma: PrismaClient,
  year: number,
  options: BatchImportedScoresOptions = {},
): Promise<BatchImportedScoresResult> {
  const page = Math.max(1, options.page ?? 1);
  const defaultSize = options.pageSize ?? 30;
  const pageSize = options.fetchAll
    ? 10000
    : Math.min(100, Math.max(1, defaultSize));
  const search = options.search?.trim();
  const employeeNo = options.employeeNo?.trim();
  const requireBasic = options.requireBasic !== false;
  const includeSheet = options.includeSheet ?? false;

  const userWhere = employeeNo
    ? { employeeNo }
    : search
    ? {
        employeeNo: { not: null as null | string },
        OR: [
          { fullName: { contains: search, mode: 'insensitive' as const } },
          { employeeNo: { contains: search } },
        ],
      }
    : { employeeNo: { not: null as null | string } };

  let employeeNos: string[] | undefined;
  if (requireBasic) {
    const basicGroups = await prisma.employeeBasicFact.groupBy({
      by: ['employeeNo'],
      where: { year },
    });
    employeeNos = basicGroups.map((g) => g.employeeNo);
  }

  const where = {
    ...userWhere,
    ...(employeeNos ? { employeeNo: { in: employeeNos } } : {}),
  };

  const [total, users, basicFacts, perfFacts, ticketUsers] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        employeeNo: true,
        fullName: true,
        hireDate: true,
        gender: true,
        profile: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { employeeNo: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.employeeBasicFact.findMany({ where: { year } }),
    prisma.performanceFact.findMany({
      where: {
        year,
        dimensionCode: { in: FACT_DIMENSION_CODES },
      },
    }),
    prisma.user.findMany({
      where: { employeeNo: { not: null } },
      select: { employeeNo: true, profile: true, hireDate: true, branch: { select: { name: true } } },
    }),
  ]);

  const specialtyByNo = new Map(
    ticketUsers.map((user) => [user.employeeNo!, ticketSpecialtyFromWorkArea(user.branch?.name)]),
  );
  const ticketNormalized = applyTicketCohortNormalization(
    perfFacts
      .filter((fact) => fact.dimensionCode === 'worksite.ticket-execution')
      .map((fact) => ({
        employeeNo: fact.employeeNo,
        cohortKey: specialtyByNo.get(fact.employeeNo) ?? '未分类专业',
        rawTicketScore: Number(fact.score),
      })),
    'specialty',
  );
  const ticketByNo = new Map(ticketNormalized.map((row) => [row.employeeNo, row]));
  const ticketSpecialtyMaxRaw = Object.fromEntries(
    [...new Set(ticketNormalized.map((row) => row.cohortKey))].map((specialty) => [
      specialty,
      ticketNormalized.find((row) => row.cohortKey === specialty)?.ticketCohortMax ?? 0,
    ]),
  );
  const ticketTierMaxRaw: Partial<Record<DeclarationTier, number>> = {};
  const ticketUserByNo = new Map(ticketUsers.map((user) => [user.employeeNo!, user]));
  for (const fact of perfFacts) {
    if (fact.dimensionCode !== 'worksite.ticket-execution') continue;
    const user = ticketUserByNo.get(fact.employeeNo);
    const hireDate = user ? effectiveHireDate(user.hireDate, user.profile) : null;
    const tier = hireDate ? levelFromHireDate(hireDate, evaluationCutoffDate(year)) : '一级';
    ticketTierMaxRaw[tier] = Math.max(ticketTierMaxRaw[tier] ?? 0, Number(fact.score));
  }

  const basicByNo = new Map<string, typeof basicFacts>();
  for (const f of basicFacts) {
    const list = basicByNo.get(f.employeeNo) ?? [];
    list.push(f);
    basicByNo.set(f.employeeNo, list);
  }

  const perfByNo = new Map<string, typeof perfFacts>();
  for (const f of perfFacts) {
    const list = perfByNo.get(f.employeeNo) ?? [];
    list.push(f);
    perfByNo.set(f.employeeNo, list);
  }

  const rows: ImportedScoreRow[] = [];

  for (const user of users) {
    const no = user.employeeNo!;
    const sheet = buildPerformanceScoreSheet({
      year,
      employeeNo: no,
      employeeName: user.fullName,
      hireDate: effectiveHireDate(user.hireDate, user.profile),
      evaluationDate: evaluationCutoffDate(year),
      mockDeclarationTier: parseMockDeclarationTier(user.profile),
      templateItems: [],
      basicFacts: (basicByNo.get(no) ?? []).map((f) => ({
        id: f.id,
        dimension: f.dimension as BasicDimension,
        tierValue: f.tierValue,
        score: Number(f.score),
        yearBreakdown: f.yearBreakdown,
      })),
      performanceFacts: (perfByNo.get(no) ?? []).map((f) => ({
        id: f.id,
        dimensionCode: f.dimensionCode,
        score: Number(f.score),
        role: f.role,
        defectRef: f.defectRef,
        defectLevel: f.defectLevel,
        eventType: f.eventType,
        metadata: f.metadata,
        sourceFile: f.sourceFile,
      })),
      ticketCohortMax: ticketByNo.get(no)?.ticketCohortMax,
    });

    const ticketFact = (perfByNo.get(no) ?? []).find(
      (f) => f.dimensionCode === 'worksite.ticket-execution',
    );
    const defectFacts = (perfByNo.get(no) ?? []).filter(
      (f) => f.dimensionCode === 'worksite.defect-governance',
    );
    const defectRaw = defectFacts.length
      ? defectFacts.reduce((s, f) => s + Number(f.score), 0)
      : null;

    const row = toImportedScoreRow(
      no,
      user.fullName,
      user.gender,
      user.branch?.name ?? null,
      user.department?.name ?? null,
      effectiveHireDate(user.hireDate, user.profile),
      sheet,
      ticketFact ? Number(ticketFact.score) : null,
      defectRaw,
    );
    if (includeSheet) {
      rows.push(row);
    } else {
      rows.push({ ...row, sheet: undefined });
    }
  }

  return { year, ticketSpecialtyMaxRaw, ticketTierMaxRaw, total, rows };
}

export interface ImportedScoreGroupSummary {
  branchName: string;
  departmentName: string | null;
  headcount: number;
  avgBasicScore: number;
  avgWorksiteScore: number;
  avgImportedTotal: number;
  maxImportedTotal: number;
  withTicketCount: number;
  withDefectCount: number;
}

/** 按分公司 / 部门汇总导入维度得分 */
export function summarizeImportedScoresByOrg(
  rows: ImportedScoreRow[],
): { byBranch: ImportedScoreGroupSummary[]; byDepartment: ImportedScoreGroupSummary[] } {
  type Acc = ImportedScoreGroupSummary & { _basic: number; _worksite: number; _total: number };

  function fold(
    keyFn: (r: ImportedScoreRow) => string,
    branchFn: (r: ImportedScoreRow) => string,
    deptFn: (r: ImportedScoreRow) => string | null,
  ): ImportedScoreGroupSummary[] {
    const map = new Map<string, Acc>();
    for (const r of rows) {
      const key = keyFn(r);
      const acc =
        map.get(key) ??
        ({
          branchName: branchFn(r),
          departmentName: deptFn(r),
          headcount: 0,
          avgBasicScore: 0,
          avgWorksiteScore: 0,
          avgImportedTotal: 0,
          maxImportedTotal: 0,
          withTicketCount: 0,
          withDefectCount: 0,
          _basic: 0,
          _worksite: 0,
          _total: 0,
        } satisfies Acc);
      acc.headcount++;
      acc._basic += r.basicScore;
      acc._worksite += r.worksiteScore;
      acc._total += r.importedTotalScore;
      if (r.ticketScore > 0) acc.withTicketCount++;
      if (r.defectScore > 0) acc.withDefectCount++;
      if (r.importedTotalScore > acc.maxImportedTotal) acc.maxImportedTotal = r.importedTotalScore;
      map.set(key, acc);
    }
    return [...map.values()]
      .map(({ _basic, _worksite, _total, ...rest }) => ({
        ...rest,
        avgBasicScore: rest.headcount ? round2(_basic / rest.headcount) : 0,
        avgWorksiteScore: rest.headcount ? round2(_worksite / rest.headcount) : 0,
        avgImportedTotal: rest.headcount ? round2(_total / rest.headcount) : 0,
        maxImportedTotal: round2(rest.maxImportedTotal),
      }))
      .sort(
        (a, b) =>
          b.avgImportedTotal - a.avgImportedTotal ||
          a.branchName.localeCompare(b.branchName, 'zh-CN'),
      );
  }

  return {
    byBranch: fold(
      (r) => r.branchName ?? '（未分配工区）',
      (r) => r.branchName ?? '（未分配工区）',
      () => null,
    ),
    byDepartment: fold(
      (r) => `${r.branchName ?? '（未分配工区）'}::${r.departmentName ?? '（未分配部门）'}`,
      (r) => r.branchName ?? '（未分配工区）',
      (r) => r.departmentName ?? '（未分配部门）',
    ),
  };
}
