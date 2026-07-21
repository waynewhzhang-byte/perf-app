import type { Prisma, PrismaClient } from '@prisma/client';
import { extractSystemFilledFromSheet } from '@/lib/system-filled-items';
import { loadPerformanceScoreSheet } from '@/lib/performance-score-sheet';

const BASIC_DIMENSIONS = new Set([
  'basic.skill-level',
  'basic.title-level',
  'basic.performance-level',
]);

const PERFORMANCE_DIMENSIONS = new Set([
  'worksite.ticket-execution',
  'worksite.defect-governance',
  'performance.safety-contribution',
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

  const scoreByItemId = new Map(
    extractSystemFilledFromSheet(sheet).map((row) => [row.itemId, row.score]),
  );
  let totalScore = 0;
  await prisma.$transaction(async (tx) => {
    for (const [itemId, score] of scoreByItemId) {
      await tx.submissionItem.updateMany({
        where: { submissionId, itemId, isSystemFilled: true },
        data: { score },
      });
    }
    const items = await tx.submissionItem.findMany({ where: { submissionId } });
    totalScore = items.reduce((sum, item) => sum + Number(item.score), 0);
    await tx.submission.update({ where: { id: submissionId }, data: { totalScore } });

    const record = await tx.performanceRecord.findUnique({
      where: { userId_year: { userId: submission.userId, year: submission.template.year } },
    });
    if (record) {
      const archivedData = record.archivedData as { items?: Array<{ itemId: string; score: number }> };
      if (Array.isArray(archivedData?.items)) {
        for (const item of archivedData.items) {
          const score = scoreByItemId.get(item.itemId);
          if (score != null) item.score = score;
        }
      }
      await tx.performanceRecord.update({
        where: { id: record.id },
        data: { totalScore, archivedData: archivedData as Prisma.InputJsonValue },
      });
    }
  });

  return { totalScore, scoreByItemId };
}
