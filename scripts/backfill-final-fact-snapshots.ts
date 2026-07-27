import { Prisma, PrismaClient } from '@prisma/client';
import { captureFinalFactSnapshot } from '@/lib/final-fact-snapshot';

const prisma = new PrismaClient();

function requestedYear(): number {
  const value = process.argv.find((arg) => arg.startsWith('--year='))?.split('=')[1];
  if (!value) {
    throw new Error('必须显式指定年度，例如 --year=2026');
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`无效年度：${value}`);
  }
  return year;
}

async function main() {
  const year = requestedYear();
  if (!process.argv.includes('--confirm-rebuild')) {
    throw new Error(
      '该操作会用当前事实重建历史归档快照；确认人工复核安排后请追加 --confirm-rebuild',
    );
  }
  const records = await prisma.performanceRecord.findMany({
    where: { year },
    select: {
      id: true,
      submissionId: true,
      totalScore: true,
      archivedData: true,
    },
    orderBy: [{ year: 'asc' }, { createdAt: 'asc' }],
  });
  let updated = 0;
  let manualReview = 0;
  let skipped = 0;

  for (const record of records) {
    const result = await prisma.$transaction(async (tx) => {
      const factSnapshot = await captureFinalFactSnapshot(tx, {
        submissionId: record.submissionId,
        archivedTotalScore: Number(record.totalScore),
        capturedAt: new Date(),
        captureMode: 'REBUILT_CURRENT_FACTS',
      });
      if (!factSnapshot) return null;
      const archivedData = (
        record.archivedData
        && typeof record.archivedData === 'object'
        && !Array.isArray(record.archivedData)
          ? { ...record.archivedData as Record<string, unknown> }
          : {}
      );
      archivedData.factSnapshot = factSnapshot;
      await tx.performanceRecord.update({
        where: { id: record.id },
        data: { archivedData: archivedData as Prisma.InputJsonValue },
      });
      return factSnapshot;
    });
    if (!result) {
      skipped += 1;
      continue;
    }
    updated += 1;
    if (result.reconciliation.status === 'MANUAL_REVIEW') manualReview += 1;
  }

  console.log(JSON.stringify({
    year,
    records: records.length,
    updated,
    manualReview,
    skipped,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
