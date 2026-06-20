/**
 * 批量计算已导入事实的绩效分表（CLI）
 *
 * 用法：pnpm compute:imported-scores -- --year 2025
 */
import { prisma } from '../src/lib/prisma';
import { batchComputeImportedScores } from '../src/lib/imported-score-batch';

function parseArgs(argv: string[]) {
  let year = new Date().getFullYear();
  let top = 10;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--year' && argv[i + 1]) year = Number(argv[++i]);
    if (argv[i] === '--top' && argv[i + 1]) top = Number(argv[++i]);
  }
  return { year, top };
}

async function main() {
  const { year, top } = parseArgs(process.argv.slice(2));

  const { ticketTierMaxRaw, total, rows } = await batchComputeImportedScores(prisma, year, {
    fetchAll: true,
    includeSheet: false,
  });

  console.log(`=== ${year} 年导入事实绩效分表（共 ${total} 人）===`);
  console.log('各能级两票原始最高分（折算基准）:', ticketTierMaxRaw);
  console.log('');

  const sorted = [...rows].sort((a, b) => b.importedTotalScore - a.importedTotalScore);
  console.log(`--- 导入维度合计 TOP ${top} ---`);
  console.log('工号\t姓名\t能级\t基本素质\t工作现场\t合计');
  for (const r of sorted.slice(0, top)) {
    console.log(
      `${r.employeeNo}\t${r.employeeName}\t${r.declarationTier ?? '-'}\t${r.basicScore}/${r.basicMaxScore}\t${r.worksiteScore}/${r.worksiteMaxScore}\t${r.importedTotalScore}/${r.importedMaxScore}`,
    );
  }

  const withWorksite = rows.filter((r) => r.worksiteScore > 0);
  console.log('');
  console.log(`有工作现场得分: ${withWorksite.length} 人（两票 ${rows.filter((r) => r.ticketScore > 0).length} / 缺陷 ${rows.filter((r) => r.defectScore > 0).length}）`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
