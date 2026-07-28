import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  readFinalFactSnapshot,
  type FinalFactSnapshot,
} from '@/lib/final-fact-snapshot';
import {
  reportSubmissionScopeWhere,
  type ReportExportFilters,
} from '@/lib/report-filters';
import { BASIC_DIMENSION_LABELS } from '@/lib/basic-dimension-map';
import { round1 } from '@/lib/rounding';

export interface FinalPerformanceReportRow {
  submissionId: string;
  employeeNo: string;
  employeeName: string;
  workAreaName: string;
  departmentName: string;
  declarationLevelName: string;
  declarationSpecialtyName: string;
  finalScore: number;
  finalizedAt: string;
  factSnapshot: FinalFactSnapshot | null;
}

export interface FinalPerformanceReportResult {
  template: { id: string; title: string; year: number };
  rows: FinalPerformanceReportRow[];
}

type ReportClient = Pick<
  PrismaClient,
  'formTemplate' | 'submission' | 'performanceRecord'
>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function loadFinalPerformanceReport(
  prisma: ReportClient,
  filters: ReportExportFilters,
): Promise<FinalPerformanceReportResult | null> {
  const template = await prisma.formTemplate.findUnique({
    where: { id: filters.templateId },
    select: { id: true, title: true, year: true },
  });
  if (!template) return null;

  const submissions = await prisma.submission.findMany({
    where: {
      templateId: filters.templateId,
      status: 'L2_APPROVED',
      ...reportSubmissionScopeWhere(filters),
    },
    select: {
      id: true,
      workAreaName: true,
      declarationLevelName: true,
      declarationSpecialtyName: true,
      l2ReviewedAt: true,
      totalScore: true,
      user: {
        select: {
          employeeNo: true,
          fullName: true,
          branch: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
    orderBy: [{ totalScore: 'desc' }, { user: { employeeNo: 'asc' } }],
  });
  const records = await prisma.performanceRecord.findMany({
    where: { submissionId: { in: submissions.map((row) => row.id) } },
    select: {
      submissionId: true,
      totalScore: true,
      archivedData: true,
      createdAt: true,
    },
  });
  const recordBySubmission = new Map(
    records.map((record) => [record.submissionId, record]),
  );

  return {
    template,
    rows: submissions.flatMap((submission) => {
      const record = recordBySubmission.get(submission.id);
      if (!record) {
        return [{
          submissionId: submission.id,
          employeeNo: submission.user.employeeNo ?? '',
          employeeName: submission.user.fullName,
          workAreaName:
            submission.workAreaName ?? submission.user.branch?.name ?? '',
          departmentName: submission.user.department?.name ?? '',
          declarationLevelName: submission.declarationLevelName ?? '',
          declarationSpecialtyName: submission.declarationSpecialtyName ?? '',
          finalScore: Number(submission.totalScore),
          finalizedAt: submission.l2ReviewedAt?.toISOString() ?? '',
          factSnapshot: null,
        }];
      }
      const factSnapshot = readFinalFactSnapshot(record.archivedData);
      const employee = factSnapshot?.employee;
      const archive = asObject(record.archivedData);
      const finalizedAt = archive.finalizedAt;
      return [{
        submissionId: submission.id,
        employeeNo:
          employee?.employeeNo ?? submission.user.employeeNo ?? '',
        employeeName: employee?.employeeName ?? submission.user.fullName,
        workAreaName:
          employee?.workAreaName
          ?? submission.workAreaName
          ?? submission.user.branch?.name
          ?? '',
        departmentName:
          employee?.departmentName ?? submission.user.department?.name ?? '',
        declarationLevelName:
          employee?.declarationLevelName
          ?? submission.declarationLevelName
          ?? '',
        declarationSpecialtyName:
          employee?.declarationSpecialtyName
          ?? submission.declarationSpecialtyName
          ?? '',
        finalScore: Number(record.totalScore),
        finalizedAt:
          typeof finalizedAt === 'string'
            ? finalizedAt
            : submission.l2ReviewedAt?.toISOString()
              ?? record.createdAt.toISOString(),
        factSnapshot,
      }];
    }),
  };
}

function headerStyle(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' },
  };
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function applyTableLayout(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(sheet.rowCount, 1), column: Math.max(sheet.columnCount, 1) },
  };
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });
}

function dimensionRows(snapshot: FinalFactSnapshot | null) {
  return snapshot?.scoreSheet.sections.flatMap((section) =>
    section.items.map((item) => ({ section, item }))) ?? [];
}

function detailText(details: Array<{ label: string; value: string }>): string {
  return details.map((detail) => `${detail.label}：${detail.value}`).join('；');
}

export function buildFinalPerformanceReportWorkbook(
  report: FinalPerformanceReportResult,
): { workbook: ExcelJS.Workbook; manualReviewCount: number } {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'perf-app';
  workbook.created = new Date();

  const dimensionColumns = new Map<string, string>();
  for (const row of report.rows) {
    for (const { item } of dimensionRows(row.factSnapshot)) {
      if (!dimensionColumns.has(item.dimensionCode)) {
        dimensionColumns.set(item.dimensionCode, item.title);
      }
    }
  }

  const summary = workbook.addWorksheet('员工绩效汇总');
  summary.addRow([
    '序号',
    '工号',
    '姓名',
    '工区',
    '部门',
    '能级',
    '专业',
    '最终绩效',
    '终审时间',
    '档案事实数',
    '基本事实数',
    '绩效事实数',
    '补充事实数',
    '一致性状态',
    ...dimensionColumns.values(),
  ]);
  headerStyle(summary.getRow(1));

  const facts = workbook.addWorksheet('绩效事实明细');
  facts.addRow([
    '工号',
    '姓名',
    '工区',
    '能级',
    '专业',
    '事实类别',
    '评价维度',
    '事实记录',
    '参与角色',
    '发生日期',
    '事实得分',
    '事实明细',
    '记录标识',
    '记录类型',
    '来源文件',
    '来源工作表',
    '来源行号',
  ]);
  headerStyle(facts.getRow(1));

  const calculations = workbook.addWorksheet('评分计算过程');
  calculations.addRow([
    '工号',
    '姓名',
    '章节',
    '评价维度',
    '数据来源',
    '事实行数',
    '事实行分数合计',
    '维度满分',
    '维度最终得分',
    '折算或封顶差额',
    '评分规则',
  ]);
  headerStyle(calculations.getRow(1));

  const exceptions = workbook.addWorksheet('人工复核');
  exceptions.addRow([
    '工号',
    '姓名',
    '异常类型',
    '归档最终分',
    '事实重算分',
    '差额',
    '处理建议',
  ]);
  headerStyle(exceptions.getRow(1));

  let manualReviewCount = 0;
  report.rows.forEach((row, index) => {
    const snapshot = row.factSnapshot;
    const scoreByDimension = new Map(
      dimensionRows(snapshot).map(({ item }) => [item.dimensionCode, item.score]),
    );
    summary.addRow([
      index + 1,
      row.employeeNo,
      row.employeeName,
      row.workAreaName,
      row.departmentName,
      row.declarationLevelName,
      row.declarationSpecialtyName,
      row.finalScore,
      row.finalizedAt,
      snapshot?.profileFacts.length ?? 0,
      snapshot?.basicFacts.length ?? 0,
      snapshot?.performanceFacts.length ?? 0,
      snapshot?.submissionFacts.length ?? 0,
      snapshot?.reconciliation.status === 'MATCHED'
        ? '一致'
        : '待人工复核',
      ...dimensionColumns.keys().map((code) => scoreByDimension.get(code) ?? ''),
    ]);

    if (!snapshot) {
      manualReviewCount += 1;
      exceptions.addRow([
        row.employeeNo,
        row.employeeName,
        '终审归档缺少事实快照',
        row.finalScore,
        '',
        '',
        '运行事实快照回填后重新导出',
      ]);
      return;
    }

    if (snapshot.reconciliation.status === 'MANUAL_REVIEW') {
      manualReviewCount += 1;
      exceptions.addRow([
        row.employeeNo,
        row.employeeName,
        '事实重算分与终审归档分不一致',
        snapshot.reconciliation.archivedTotalScore,
        snapshot.reconciliation.recalculatedTotalScore,
        snapshot.reconciliation.difference,
        '核对事实记录、折算基准及终审评分后确认',
      ]);
    }

    for (const fact of snapshot.profileFacts) {
      facts.addRow([
        row.employeeNo,
        row.employeeName,
        row.workAreaName,
        row.declarationLevelName,
        row.declarationSpecialtyName,
        '员工档案事实',
        fact.dimensionTitle,
        fact.value,
        '',
        '',
        fact.score,
        `参加工作时间：${fact.value}`,
        fact.id,
        fact.dimensionCode,
        fact.sourceFile,
        '',
        '',
      ]);
    }
    for (const fact of snapshot.basicFacts) {
      facts.addRow([
        row.employeeNo,
        row.employeeName,
        row.workAreaName,
        row.declarationLevelName,
        row.declarationSpecialtyName,
        '基本事实',
        BASIC_DIMENSION_LABELS[fact.dimension],
        fact.tierValue,
        '',
        '',
        fact.score,
        fact.yearBreakdown ? JSON.stringify(fact.yearBreakdown) : '',
        fact.id,
        fact.dimension,
        fact.sourceFile,
        '',
        '',
      ]);
    }
    for (const fact of snapshot.performanceFacts) {
      facts.addRow([
        row.employeeNo,
        row.employeeName,
        row.workAreaName,
        row.declarationLevelName,
        row.declarationSpecialtyName,
        '绩效事实',
        fact.dimensionTitle,
        fact.record.title,
        fact.record.roleLabel ?? '',
        fact.record.occurredAt ?? fact.eventDate ?? '',
        fact.score,
        detailText(fact.record.details),
        fact.record.recordKey,
        fact.record.recordType,
        fact.record.source.file ?? fact.sourceFile,
        fact.record.source.sheet ?? '',
        fact.record.source.rowNo ?? '',
      ]);
    }
    for (const fact of snapshot.submissionFacts) {
      const isAppeal = String(fact.sourceFile).startsWith('appeal-supplement:');
      facts.addRow([
        row.employeeNo,
        row.employeeName,
        row.workAreaName,
        row.declarationLevelName,
        row.declarationSpecialtyName,
        isAppeal ? '申诉补充事实' : '员工补充事实',
        fact.dimensionTitle,
        fact.label,
        '',
        '',
        fact.score,
        fact.content ?? '',
        fact.id,
        fact.dimensionCode,
        fact.sourceFile,
        '',
        '',
      ]);
    }

    for (const { section, item } of dimensionRows(snapshot)) {
      const lineTotal = round1(
        item.lines.reduce((total, line) => total + Number(line.score), 0),
      );
      calculations.addRow([
        row.employeeNo,
        row.employeeName,
        section.title,
        item.title,
        item.source,
        item.lines.length,
        lineTotal,
        item.maxScore,
        item.score,
        round1(item.score - lineTotal),
        item.ruleSummary,
      ]);
    }
  });

  summary.columns = [
    { width: 8 },
    { width: 16 },
    { width: 12 },
    { width: 20 },
    { width: 18 },
    { width: 12 },
    { width: 18 },
    { width: 12 },
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    ...[...dimensionColumns].map(() => ({ width: 16 })),
  ];
  facts.columns = [
    { width: 16 },
    { width: 12 },
    { width: 20 },
    { width: 12 },
    { width: 18 },
    { width: 14 },
    { width: 24 },
    { width: 36 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
    { width: 48 },
    { width: 32 },
    { width: 20 },
    { width: 28 },
    { width: 20 },
    { width: 12 },
  ];
  calculations.columns = [
    { width: 16 },
    { width: 12 },
    { width: 18 },
    { width: 24 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
    { width: 12 },
    { width: 16 },
    { width: 18 },
    { width: 56 },
  ];
  exceptions.columns = [
    { width: 16 },
    { width: 12 },
    { width: 34 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
    { width: 48 },
  ];
  [summary, facts, calculations, exceptions].forEach(applyTableLayout);

  const metadata = workbook.addWorksheet('导出说明');
  metadata.addRows([
    ['项目', '内容'],
    ['申报表', report.template.title],
    ['年度', report.template.year],
    ['终审员工数', report.rows.length],
    ['待人工复核人数', manualReviewCount],
    ['数据口径', '最终绩效、事实明细和计算过程均取自终审 PerformanceRecord 归档快照'],
  ]);
  headerStyle(metadata.getRow(1));
  metadata.getColumn(1).width = 24;
  metadata.getColumn(2).width = 88;

  return { workbook, manualReviewCount };
}

export async function buildFinalPerformanceReportBuffer(
  prisma: ReportClient,
  filters: ReportExportFilters,
): Promise<{
  buffer: Buffer;
  report: FinalPerformanceReportResult;
  manualReviewCount: number;
} | null> {
  const report = await loadFinalPerformanceReport(prisma, filters);
  if (!report) return null;
  const { workbook, manualReviewCount } =
    buildFinalPerformanceReportWorkbook(report);
  const data = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.isBuffer(data) ? data : Buffer.from(data),
    report,
    manualReviewCount,
  };
}
