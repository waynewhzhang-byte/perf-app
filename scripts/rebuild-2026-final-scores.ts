#!/usr/bin/env npx tsx
/**
 * 以当前导入事实重建年度申报分数及已归档的最终绩效快照。
 *
 * 两票会在 loadPerformanceScoreSheet 中按工区归并的专业最高原始分折算到 30 分。
 * 用法：npx tsx scripts/rebuild-2026-final-scores.ts [--year 2026]
 */
import { prisma } from '@/lib/prisma';
import { recalculateFactBackedSubmission } from '@/lib/fact-correction';
import { batchComputeImportedScores } from '@/lib/imported-score-batch';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const year = Number(argValue('--year', '2026'));
  const records = await prisma.performanceRecord.findMany({
    where: { year },
    select: { submissionId: true },
  });

  const rebuilt = [] as Array<{ submissionId: string; totalScore: number }>;
  for (const record of records) {
    const result = await recalculateFactBackedSubmission(prisma, record.submissionId);
    rebuilt.push({ submissionId: record.submissionId, totalScore: result.totalScore });
  }

  const imported = await batchComputeImportedScores(prisma, year, { fetchAll: true });
  console.log(JSON.stringify({
    year,
    importedEmployees: imported.total,
    ticketSpecialtyMaxRaw: imported.ticketSpecialtyMaxRaw,
    recalculatedSubmissions: rebuilt.length,
    rebuiltPerformanceRecords: records.length,
    submissions: rebuilt,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
