/**
 * 导出导入事实绩效分表 Excel
 *
 * 用法：pnpm export:imported-scores -- --year 2025
 *       pnpm export:imported-scores -- --year 2025 --output data/generated/2025-imported-scores.xlsx
 */
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { prisma } from '../src/lib/prisma';
import { batchComputeImportedScores } from '../src/lib/imported-score-batch';
import { writeImportedScoresXlsx } from '../src/lib/imported-score-xlsx';

function parseArgs(argv: string[]) {
  let year = new Date().getFullYear();
  let output = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--year' && argv[i + 1]) year = Number(argv[++i]);
    if (argv[i] === '--output' && argv[i + 1]) output = argv[++i];
  }
  if (!output) {
    output = resolve(`data/generated/${year}年导入事实绩效分表.xlsx`);
  }
  return { year, output: resolve(output) };
}

async function main() {
  const { year, output } = parseArgs(process.argv.slice(2));

  const result = await batchComputeImportedScores(prisma, year, { fetchAll: true });
  if (result.rows.length === 0) {
    console.error('无数据：请先导入基本素质事实');
    process.exit(1);
  }

  mkdirSync(dirname(output), { recursive: true });
  await writeImportedScoresXlsx(result, output);

  console.log(`已导出 ${result.rows.length} 人 → ${output}`);
  console.log('工作表：个人分表 / 工区汇总 / 部门汇总 / 计算说明');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
