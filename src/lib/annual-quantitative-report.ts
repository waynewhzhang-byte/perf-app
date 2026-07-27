import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { computeLevel, DECLARATION_LEVELS, evaluationCutoffDate, type DeclarationLevel } from './declaration-level';
import {
  aggregateEmployeeDimensions,
  applyTicketCohortNormalization,
  cappedPair,
  dimensionFactCount,
  dimensionRaw,
  dimensionScore,
  parentCap,
  round1,
} from './dimension-aggregation';
import {
  ALL_QUANTITATIVE_REPORT_UNITS,
  quantitativeReportUnitLabel,
  type QuantitativeReportRow,
} from './quantitative-report-contract';

const DIMENSIONS = {
  safety: 'performance.safety-contribution',
  technicalTextbook: 'performance.technical-contribution.textbook',
  technicalRegulation: 'performance.technical-contribution.regulation',
  technicalTicket: 'performance.technical-contribution.ticket-revision',
  competitionEvent: 'performance.competition.competition',
  competitionExam: 'performance.competition.exam',
  innovationAward: 'performance.innovation.award',
  innovationPaper: 'performance.innovation.paper-patent',
  ticket: 'worksite.ticket-execution',
  defect: 'worksite.defect-governance',
  violationSevere: 'special.violation-severe',
  violationGeneral: 'special.violation-general',
} as const;

export interface AnnualQuantitativeReportOptions {
  year: number;
  unit: string;
  branchId?: string;
  asOf?: Date;
  /**
   * 软降级回调：员工因 profile 不全（如缺少「参加工作时间」）被跳过时触发。
   * 不传时静默跳过——不再像以前那样 throw，避免一个 E2E/测试账号阻塞整份报表。
   */
  onSkip?: (employeeNo: string, reason: string) => void;
}

export interface AnnualReportUserSource {
  employeeNo: string | null;
  fullName: string;
  gender: string | null;
  profile: unknown;
  branch: { id?: string; name: string } | null;
  position: { name: string } | null;
}

export interface AnnualBasicFactSource {
  employeeNo: string;
  dimension: string;
  score: unknown;
}

export interface AnnualPerformanceFactSource {
  employeeNo: string;
  dimensionCode: string;
  score: unknown;
}

export const QUANTITATIVE_DIMENSIONS = [
  { key: 'skillLevel', label: '技能等级', group: '基本素质' },
  { key: 'titleLevel', label: '职称等级', group: '基本素质' },
  { key: 'performanceLevel', label: '绩效等级', group: '基本素质' },
  { key: 'safetyContribution', label: '安全贡献', group: '工作业绩' },
  { key: 'technicalStandard', label: '国标、行标、企标', group: '工作业绩' },
  { key: 'technicalResource', label: '规范标准、资源库', group: '工作业绩' },
  { key: 'competitionEvent', label: '生产类竞赛', group: '工作业绩' },
  { key: 'competitionExam', label: '生产类调考', group: '工作业绩' },
  { key: 'innovationAward', label: '创新奖项', group: '工作业绩' },
  { key: 'innovationPaper', label: '论文专利', group: '工作业绩' },
  { key: 'ticketExecution', label: '两票执行', group: '工作现场' },
  { key: 'defectGovernance', label: '缺陷治理', group: '工作现场' },
  { key: 'violationSevere', label: '严重违章', group: '扣分项' },
  { key: 'violationGeneral', label: '一般违章', group: '扣分项' },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<
    QuantitativeReportRow,
    | 'skillLevel'
    | 'titleLevel'
    | 'performanceLevel'
    | 'safetyContribution'
    | 'technicalStandard'
    | 'technicalResource'
    | 'competitionEvent'
    | 'competitionExam'
    | 'innovationAward'
    | 'innovationPaper'
    | 'ticketExecution'
    | 'defectGovernance'
    | 'violationSevere'
    | 'violationGeneral'
  >;
  label: string;
  group: '基本素质' | '工作业绩' | '工作现场' | '扣分项';
}>;

export interface QuantitativeAnalysisRecord extends QuantitativeReportRow {
  basicScore: number;
  performanceScore: number;
  worksiteScore: number;
  deductionScore: number;
  totalScore: number;
  rank: number;
}

export interface QuantitativeBranchBreakdown {
  unit: string;
  employeeCount: number;
  averageTotalScore: number;
  tierCounts: Record<DeclarationLevel, number>;
}

export interface AnnualQuantitativeReportAnalysis {
  employeeCount: number;
  averageTotalScore: number;
  maxTotalScore: number;
  minTotalScore: number;
  tierCounts: Record<DeclarationLevel, number>;
  dimensionAverages: Array<(typeof QUANTITATIVE_DIMENSIONS)[number] & { average: number }>;
  branchBreakdown: QuantitativeBranchBreakdown[];
  records: QuantitativeAnalysisRecord[];
}

type Profile = Record<string, unknown>;

function profileText(profile: unknown, key: string): string {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return '';
  const value = (profile as Profile)[key];
  return value == null ? '' : String(value).trim();
}

function parseDateParts(value: string | Date): { year: number; month: number; day: number } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
  }
  const match = value.trim().match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** 截至指定日期已经完成的整年工龄。 */
export function workYearsAsOf(startDate: string | Date, asOf: Date): number | null {
  const start = parseDateParts(startDate);
  if (!start || Number.isNaN(asOf.getTime())) return null;
  const end = { year: asOf.getUTCFullYear(), month: asOf.getUTCMonth() + 1, day: asOf.getUTCDate() };
  let years = end.year - start.year;
  if (end.month < start.month || (end.month === start.month && end.day < start.day)) years -= 1;
  return Math.max(0, years);
}

/** 为管理员分析页构建与量化积分报送表相同口径的汇总和员工明细。 */
export function buildAnnualQuantitativeReportAnalysis(
  rows: QuantitativeReportRow[],
): AnnualQuantitativeReportAnalysis {
  const records = rows
    .map((row) => {
      const basicScore = round1(row.skillLevel + row.titleLevel + row.performanceLevel);
      const performanceScore = round1(
        row.safetyContribution + row.technicalStandard + row.technicalResource
        + row.competitionEvent + row.competitionExam + row.innovationAward + row.innovationPaper,
      );
      const worksiteScore = round1(row.ticketExecution + row.defectGovernance);
      const deductionScore = round1(row.violationSevere + row.violationGeneral);
      return {
        ...row,
        basicScore,
        performanceScore,
        worksiteScore,
        deductionScore,
        totalScore: round1(basicScore + performanceScore + worksiteScore + deductionScore),
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.employeeNo.localeCompare(b.employeeNo))
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const employeeCount = records.length;
  const totals = records.map((row) => row.totalScore);
  const tierCounts = Object.fromEntries(
    DECLARATION_LEVELS.map((tier) => [tier, records.filter((row) => row.tier === tier).length]),
  ) as Record<DeclarationLevel, number>;

  const branchMap = new Map<string, QuantitativeAnalysisRecord[]>();
  for (const record of records) {
    const list = branchMap.get(record.unit) ?? [];
    list.push(record);
    branchMap.set(record.unit, list);
  }
  const branchBreakdown = [...branchMap.entries()]
    .map(([unit, branchRecords]) => {
      const branchTotals = branchRecords.map((row) => row.totalScore);
      return {
        unit,
        employeeCount: branchRecords.length,
        averageTotalScore: round1(branchTotals.reduce((sum, score) => sum + score, 0) / branchRecords.length),
        tierCounts: Object.fromEntries(
          DECLARATION_LEVELS.map((level) => [level, branchRecords.filter((row) => row.tier === level).length]),
        ) as Record<DeclarationLevel, number>,
      };
    })
    .sort((a, b) => b.employeeCount - a.employeeCount || a.unit.localeCompare(b.unit, 'zh-CN'));

  return {
    employeeCount,
    averageTotalScore: employeeCount === 0 ? 0 : round1(totals.reduce((sum, score) => sum + score, 0) / employeeCount),
    maxTotalScore: employeeCount === 0 ? 0 : Math.max(...totals),
    minTotalScore: employeeCount === 0 ? 0 : Math.min(...totals),
    tierCounts,
    dimensionAverages: QUANTITATIVE_DIMENSIONS.map((dimension) => ({
      ...dimension,
      average: employeeCount === 0
        ? 0
        : round1(records.reduce((sum, row) => sum + row[dimension.key], 0) / employeeCount),
    })),
    branchBreakdown,
    records,
  };
}

export function buildAnnualQuantitativeReportRows(
  users: AnnualReportUserSource[],
  basicFacts: AnnualBasicFactSource[],
  performanceFacts: AnnualPerformanceFactSource[],
  options: AnnualQuantitativeReportOptions,
): QuantitativeReportRow[] {
  const asOf = options.asOf ?? evaluationCutoffDate(options.year);

  const basicByEmployee = new Map<string, AnnualBasicFactSource[]>();
  for (const fact of basicFacts) {
    const list = basicByEmployee.get(fact.employeeNo) ?? [];
    list.push(fact);
    basicByEmployee.set(fact.employeeNo, list);
  }
  const performanceByEmployee = new Map<string, AnnualPerformanceFactSource[]>();
  for (const fact of performanceFacts) {
    const list = performanceByEmployee.get(fact.employeeNo) ?? [];
    list.push(fact);
    performanceByEmployee.set(fact.employeeNo, list);
  }

  const provisional = users.flatMap((user) => {
    if (!user.employeeNo) return [];
    const workYears = workYearsAsOf(profileText(user.profile, '参加工作时间'), asOf);
    if (workYears === null) {
      // 软降级：profile 缺「参加工作时间」（常见于 E2E 账号或尚未申报的员工）。
      // 历史 bug：原 throw 会让单个 profile 不全的员工阻塞整份报表生成。
      options.onSkip?.(user.employeeNo, '缺少有效的参加工作时间');
      return [];
    }

    const totals = aggregateEmployeeDimensions({
      employeeNo: user.employeeNo,
      performanceFacts: (performanceByEmployee.get(user.employeeNo) ?? []).map((f) => ({
        dimensionCode: f.dimensionCode,
        score: Number(f.score),
      })),
      basicFacts: (basicByEmployee.get(user.employeeNo) ?? []).map((f) => ({
        dimension: f.dimension,
        score: Number(f.score),
      })),
    });

    const [technicalStandard, technicalResource] = cappedPair(
      dimensionRaw(totals, DIMENSIONS.technicalRegulation)
        + dimensionRaw(totals, DIMENSIONS.technicalTicket),
      dimensionRaw(totals, DIMENSIONS.technicalTextbook),
      parentCap('performance.technical-contribution'),
    );
    const [competitionEvent, competitionExam] = cappedPair(
      dimensionRaw(totals, DIMENSIONS.competitionEvent),
      dimensionRaw(totals, DIMENSIONS.competitionExam),
      parentCap('performance.competition'),
    );
    const [innovationAward, innovationPaper] = cappedPair(
      dimensionRaw(totals, DIMENSIONS.innovationAward),
      dimensionRaw(totals, DIMENSIONS.innovationPaper),
      parentCap('performance.innovation'),
    );

    const specialty = profileText(user.profile, '岗位分类')
      || profileText(user.profile, '岗位分类代码')
      || profileText(user.profile, '岗位')
      || user.position?.name
      || '未分类专业';

    return [{
      seq: 0,
      employeeNo: user.employeeNo,
      fullName: user.fullName,
      gender: user.gender ?? '',
      unit: user.branch?.name ?? options.unit,
      specialty,
      position: user.position?.name ?? profileText(user.profile, '岗位'),
      workYears: String(workYears),
      skillLevel: dimensionScore(totals, 'basic.skill-level'),
      titleLevel: dimensionScore(totals, 'basic.title-level'),
      performanceLevel: dimensionScore(totals, 'basic.performance-level'),
      safetyContribution: dimensionScore(totals, DIMENSIONS.safety),
      technicalStandard,
      technicalResource,
      competitionEvent,
      competitionExam,
      innovationAward,
      innovationPaper,
      ticketExecution: 0,
      defectGovernance: dimensionScore(totals, DIMENSIONS.defect),
      violationSevere: dimensionScore(totals, DIMENSIONS.violationSevere),
      violationGeneral: dimensionScore(totals, DIMENSIONS.violationGeneral),
      tier: computeLevel(workYears),
      rawDefectScore: dimensionRaw(totals, DIMENSIONS.defect),
      rawSafetyScore: dimensionRaw(totals, DIMENSIONS.safety),
      rawTicketScore: totals.rawTicketScore,
      ticketTierMaxRaw: 0,
      factCount: dimensionFactCount(totals, DIMENSIONS.defect),
      safetyFactCount: dimensionFactCount(totals, DIMENSIONS.safety),
    } satisfies QuantitativeReportRow];
  });

  const ticketNormalized = applyTicketCohortNormalization(
    provisional.map((row) => ({
      employeeNo: row.employeeNo,
      cohortKey: row.specialty,
      rawTicketScore: row.rawTicketScore,
    })),
    'specialty',
  );
  const ticketByEmployee = new Map(
    ticketNormalized.map((row) => [row.employeeNo, row]),
  );

  return provisional
    .map((row) => {
      const ticket = ticketByEmployee.get(row.employeeNo);
      return {
        ...row,
        ticketTierMaxRaw: ticket?.ticketCohortMax ?? 0,
        ticketExecution: ticket?.ticketScore ?? 0,
      };
    })
    .sort((a, b) =>
      DECLARATION_LEVELS.indexOf(a.tier) - DECLARATION_LEVELS.indexOf(b.tier) ||
      b.rawTicketScore - a.rawTicketScore ||
      a.employeeNo.localeCompare(b.employeeNo),
    );
}

/** 从员工档案和指定年度导入事实生成量化积分报送行。 */
export async function loadAnnualQuantitativeReportRows(
  prisma: PrismaClient,
  options: AnnualQuantitativeReportOptions,
): Promise<QuantitativeReportRow[]> {
  const users = await prisma.user.findMany({
    where: { employeeNo: { not: null } },
    select: {
      employeeNo: true,
      fullName: true,
      gender: true,
      profile: true,
      branch: { select: { id: true, name: true } },
      position: { select: { name: true } },
    },
    orderBy: [{ employeeNo: 'asc' }],
  });
  const selectedEmployeeNos = new Set(
    users.flatMap((user) => {
      const selected = options.unit === ALL_QUANTITATIVE_REPORT_UNITS
        || (options.branchId ? user.branch?.id === options.branchId : user.branch?.name === options.unit);
      return selected && user.employeeNo ? [user.employeeNo] : [];
    }),
  );
  if (selectedEmployeeNos.size === 0) return [];

  const employeeNos = users.flatMap((user) => (user.employeeNo ? [user.employeeNo] : []));

  const [basicFacts, performanceFacts] = await Promise.all([
    prisma.employeeBasicFact.findMany({
      where: { year: options.year, employeeNo: { in: employeeNos } },
      select: { employeeNo: true, dimension: true, score: true },
    }),
    prisma.performanceFact.findMany({
      where: { year: options.year, employeeNo: { in: employeeNos } },
      select: { employeeNo: true, dimensionCode: true, score: true },
    }),
  ]);
  return buildAnnualQuantitativeReportRows(users, basicFacts, performanceFacts, options)
    .filter((row) => selectedEmployeeNos.has(row.employeeNo));
}

function setHeaderRows(sheet: ExcelJS.Worksheet, year: number, tier: DeclarationLevel) {
  sheet.mergeCells('A1:U1');
  sheet.getCell('A1').value = `国网山西超高压变电公司${year}年能级评价个人量化积分统计公示表`;
  sheet.getCell('A1').font = { name: '宋体', bold: true, size: 16 };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 30;

  sheet.mergeCells('A2:A4');
  sheet.getCell('A2').value = '序号';
  for (const [range, label] of [
    ['B2:G2', '个人信息'],
    ['H2:J2', '基本素质'],
    ['K2:Q2', '工作业绩'],
    ['R2:S2', '工作现场'],
    ['T2:U2', '特殊事项'],
  ] as const) {
    sheet.mergeCells(range);
    sheet.getCell(range.split(':')[0]).value = label;
  }

  const verticalHeaders: Array<[string, string]> = [
    ['B3:B4', '姓名'],
    ['C3:C4', '性别'],
    ['D3:D4', '所在单位'],
    ['E3:E4', tier === '一级' ? '所属专业' : '申报专业'],
    ['F3:F4', '岗位职务'],
    ['G3:G4', `工作年限（截至${year}年7月）`],
    ['H3:H4', '技能等级'],
    ['I3:I4', '职称等级'],
    ['J3:J4', '绩效等级'],
    ['K3:K4', '安全贡献'],
    ['R3:R4', '两票执行'],
    ['S3:S4', '缺陷治理'],
  ];
  for (const [range, label] of verticalHeaders) {
    sheet.mergeCells(range);
    sheet.getCell(range.split(':')[0]).value = label;
  }
  for (const [range, label] of [
    ['L3:M3', '技术贡献'],
    ['N3:O3', '竞赛比武'],
    ['P3:Q3', '发明创新'],
    ['T3:U3', '扣分项'],
  ] as const) {
    sheet.mergeCells(range);
    sheet.getCell(range.split(':')[0]).value = label;
  }
  for (const [cell, value] of [
    ['L4', '国标、行标、企标'],
    ['M4', '规范标准、资源库'],
    ['N4', '生产类竞赛'],
    ['O4', '生产类调考'],
    ['P4', '创新奖项'],
    ['Q4', '论文专利'],
    ['T4', '严重违章'],
    ['U4', '一般违章'],
  ] as const) sheet.getCell(cell).value = value;

  for (let row = 2; row <= 4; row += 1) {
    sheet.getRow(row).height = row === 4 ? 34 : 26;
    for (let col = 1; col <= 21; col += 1) {
      const cell = sheet.getCell(row, col);
      cell.font = { name: '宋体', bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } };
    }
  }
}

function addDataRow(sheet: ExcelJS.Worksheet, rowIndex: number, seq: number, data: QuantitativeReportRow) {
  sheet.getRow(rowIndex).values = [
    seq,
    data.fullName,
    data.gender,
    data.unit,
    data.specialty,
    data.position,
    Number(data.workYears),
    data.skillLevel,
    data.titleLevel,
    data.performanceLevel,
    data.safetyContribution,
    data.technicalStandard,
    data.technicalResource,
    data.competitionEvent,
    data.competitionExam,
    data.innovationAward,
    data.innovationPaper,
    data.ticketExecution,
    data.defectGovernance,
    data.violationSevere,
    data.violationGeneral,
  ];
  sheet.getRow(rowIndex).height = 24;
  for (let col = 1; col <= 21; col += 1) {
    const cell = sheet.getCell(rowIndex, col);
    cell.font = { name: '宋体', size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if (col >= 8) cell.numFmt = '0.0#';
  }
}

function applySheetLayout(sheet: ExcelJS.Worksheet, lastRow: number) {
  const widths = [6, 10, 7, 18, 24, 22, 17, 10, 10, 10, 10, 12, 12, 11, 11, 11, 11, 11, 11, 11, 11];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let row = 1; row <= lastRow; row += 1) {
    for (let col = 1; col <= 21; col += 1) {
      sheet.getCell(row, col).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    }
  }
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `A1:U${lastRow}`,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
}

export function buildAnnualQuantitativeReportWorkbook(
  rows: QuantitativeReportRow[],
  options: Pick<AnnualQuantitativeReportOptions, 'year' | 'unit'>,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'perf-app';
  workbook.created = new Date();

  for (const tier of DECLARATION_LEVELS) {
    const sheet = workbook.addWorksheet(tier);
    setHeaderRows(sheet, options.year, tier);
    const tierRows = rows.filter((row) => row.tier === tier);
    tierRows.forEach((row, index) => addDataRow(sheet, index + 5, index + 1, row));
    const footerRow = tierRows.length + 5;
    sheet.mergeCells(`A${footerRow}:G${footerRow}`);
    sheet.getCell(`A${footerRow}`).value = '经办人（签字）：';
    sheet.mergeCells(`R${footerRow}:S${footerRow}`);
    sheet.getCell(`R${footerRow}`).value = '主任签字：';
    sheet.getRow(footerRow).height = 30;
    applySheetLayout(sheet, footerRow);
  }

  const rules = workbook.addWorksheet('积分规则');
  rules.addRows([
    ['项目', '规则'],
    ['评价年度', options.year],
    ['报送单位', quantitativeReportUnitLabel(options.unit)],
    ['能级三级', '工龄0—4年（不满5年）'],
    ['能级二级', '工龄5—8年（满5年、不满9年）'],
    ['能级一级', '工龄9年及以上'],
    ['工龄截止日期', `${options.year}年7月31日`],
    ['两票执行折算', '个人全年原始分累加；本专业最高分计30分，其余按个人原始分÷本专业最高分×30折算'],
    ['数据来源', '本地数据库员工档案、EmployeeBasicFact、PerformanceFact'],
  ]);
  rules.getRow(1).font = { bold: true };
  rules.getColumn(1).width = 22;
  rules.getColumn(2).width = 72;

  const roster = workbook.addWorksheet('工号名册');
  roster.addRow(['工号', '姓名', '单位', '工龄', '能级', '技能', '职称', '绩效', '工作业绩', '工作现场', '扣分']);
  roster.getRow(1).font = { bold: true };
  for (const row of rows) {
    roster.addRow([
      row.employeeNo,
      row.fullName,
      row.unit,
      Number(row.workYears),
      row.tier,
      row.skillLevel,
      row.titleLevel,
      row.performanceLevel,
      round1(row.safetyContribution + row.technicalStandard + row.technicalResource + row.competitionEvent + row.competitionExam + row.innovationAward + row.innovationPaper),
      round1(row.ticketExecution + row.defectGovernance),
      round1(row.violationSevere + row.violationGeneral),
    ]);
  }
  roster.columns.forEach((column) => { column.width = 16; });
  roster.getColumn(2).width = 12;
  roster.getColumn(3).width = 20;

  return workbook;
}

export async function buildAnnualQuantitativeReportBuffer(
  prisma: PrismaClient,
  options: AnnualQuantitativeReportOptions,
): Promise<{ buffer: Buffer; rows: QuantitativeReportRow[] }> {
  const rows = await loadAnnualQuantitativeReportRows(prisma, options);
  if (rows.length === 0) return { buffer: Buffer.alloc(0), rows };
  const workbook = buildAnnualQuantitativeReportWorkbook(rows, options);
  const data = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.isBuffer(data) ? data : Buffer.from(data), rows };
}
