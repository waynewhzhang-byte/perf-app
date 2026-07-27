import type { Prisma, PrismaClient } from '@prisma/client';
import { extractSystemFilledFromSheet } from '@/lib/system-filled-items';
import { loadPerformanceScoreSheet } from '@/lib/performance-score-sheet';
import { computeSectionScores, type ScorableSection } from '@/lib/score-calculation';
import { captureFinalFactSnapshot } from '@/lib/final-fact-snapshot';

const BASIC_DIMENSIONS = new Set([
  'basic.skill-level',
  'basic.title-level',
  'basic.performance-level',
]);

const PERFORMANCE_DIMENSIONS = new Set([
  'worksite.ticket-execution',
  'worksite.defect-governance',
  'performance.safety-contribution',
  'performance.technical-contribution',
  'performance.competition',
  'performance.innovation',
  'special.violation-severe',
  'special.violation-general',
]);

export type FactCorrectionKind = 'BASIC' | 'PERFORMANCE';

export function factKindForDimension(dimensionCode: string): FactCorrectionKind | null {
  if (BASIC_DIMENSIONS.has(dimensionCode)) return 'BASIC';
  if (PERFORMANCE_DIMENSIONS.has(dimensionCode)) return 'PERFORMANCE';
  return null;
}

/** Rebuild the system-filled item scores and dependent aggregate records from current facts. */
export async function recalculateFactBackedSubmission(
  prisma: PrismaClient,
  submissionId: string,
) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { user: { select: { employeeNo: true } }, template: { select: { year: true } } },
  });
  if (!submission?.user.employeeNo) throw new Error('申报员工缺少工号，无法重算事实分数');

  const sheet = await loadPerformanceScoreSheet({
    prisma,
    year: submission.template.year,
    employeeNo: submission.user.employeeNo,
    templateId: submission.templateId,
    userId: submission.userId,
  });
  if (!sheet) throw new Error('无法加载员工事实绩效表');

  const systemRowsByItemId = new Map(
    extractSystemFilledFromSheet(sheet).map((row) => [row.itemId, row]),
  );
  const template = await prisma.formTemplate.findUnique({
    where: { id: submission.templateId },
    select: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          sortOrder: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, scoreMode: true, maxScore: true, maxSelections: true, scoreOptions: true, sortOrder: true },
          },
        },
      },
    },
  });
  const templateSections: ScorableSection[] = (template?.sections ?? []).map((section) => ({
    id: section.id,
    title: section.title,
    sortOrder: section.sortOrder,
    items: section.items.map((item) => ({
      id: item.id,
      scoreMode: item.scoreMode,
      maxScore: item.maxScore != null ? Number(item.maxScore) : null,
      maxSelections: item.maxSelections,
      scoreOptions: item.scoreOptions,
      sortOrder: item.sortOrder,
    })),
  }));
  let totalScore = 0;
  await prisma.$transaction(async (tx) => {
    for (const [itemId, row] of systemRowsByItemId) {
      await tx.submissionItem.updateMany({
        where: { submissionId, itemId, isSystemFilled: true },
        data: { score: row.score, selected: row.selected as Prisma.InputJsonValue },
      });
    }
    const items = await tx.submissionItem.findMany({ where: { submissionId } });
    totalScore = items.reduce((sum, item) => sum + Number(item.score), 0);
    await tx.submission.update({ where: { id: submissionId }, data: { totalScore } });

    const record = await tx.performanceRecord.findUnique({
      where: { userId_year: { userId: submission.userId, year: submission.template.year } },
    });
    if (record) {
      const archivedData = record.archivedData as {
        items?: Array<{ itemId: string; score: number; selected?: unknown }>;
        sections?: unknown;
        factSnapshot?: unknown;
      };
      if (Array.isArray(archivedData?.items)) {
        for (const item of archivedData.items) {
          const row = systemRowsByItemId.get(item.itemId);
          if (row) {
            item.score = row.score;
            item.selected = row.selected;
          }
        }
      }
      archivedData.sections = computeSectionScores(
        templateSections,
        new Map(items.map((item) => [item.itemId, Number(item.score)])),
      );
      const factSnapshot = await captureFinalFactSnapshot(tx, {
        submissionId,
        archivedTotalScore: totalScore,
        capturedAt: new Date(),
      });
      if (factSnapshot) archivedData.factSnapshot = factSnapshot;
      await tx.performanceRecord.update({
        where: { id: record.id },
        data: { totalScore, archivedData: archivedData as Prisma.InputJsonValue },
      });
    }
  });

  return { totalScore, scoreByItemId: new Map([...systemRowsByItemId].map(([itemId, row]) => [itemId, row.score])) };
}

/**
 * 事实台账发生批量替换后，刷新受影响员工已保存的申报和终审档案。
 * 仅更新已存在的系统填充项；员工已通过审核的补充事实保持原样并由归档事实追溯。
 */
export async function refreshFactBackedSubmissionsByEmployeeNos(
  prisma: PrismaClient,
  year: number,
  employeeNos: Iterable<string>,
) {
  const numbers = [...new Set([...employeeNos].filter(Boolean))];
  if (numbers.length === 0) return { submissions: 0, records: 0 };

  const submissions = await prisma.submission.findMany({
    where: {
      template: { year },
      user: { employeeNo: { in: numbers } },
      items: { some: { isSystemFilled: true } },
    },
    select: { id: true, status: true },
  });

  let records = 0;
  for (const submission of submissions) {
    await recalculateFactBackedSubmission(prisma, submission.id);
    if (submission.status === 'L2_APPROVED') records += 1;
  }
  return { submissions: submissions.length, records };
}
