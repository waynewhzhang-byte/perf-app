/**
 * 事实数据导入流水线 CLI（调用 import-pipeline 模块）
 */
import { prisma } from '../src/lib/prisma';
import { runImportPipeline } from '../src/lib/import-pipeline';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {
    dryRun: false,
    skipBasic: false,
    skipTickets: false,
    skipDefects: false,
    skipSafety: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--skip-basic') args.skipBasic = true;
    else if (a === '--skip-tickets') args.skipTickets = true;
    else if (a === '--skip-defects') args.skipDefects = true;
    else if (a === '--skip-safety') args.skipSafety = true;
    else if (a === '--year' && argv[i + 1]) args.year = argv[++i];
    else if (a === '--basic' && argv[i + 1]) args.basic = argv[++i];
    else if (a === '--tickets' && argv[i + 1]) args.tickets = argv[++i];
    else if (a === '--defects' && argv[i + 1]) args.defects = argv[++i];
    else if (a === '--safety' && argv[i + 1]) args.safety = argv[++i];
    else if (a === '--unit' && argv[i + 1]) args.unit = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = Number(args.year ?? 2025);

  console.log('=== 绩效事实数据导入流水线 ===');
  console.log(`评价年度: ${year}`);
  console.log(`模式: ${args.dryRun ? '试运行' : '写入数据库'}`);
  console.log('');

  const result = await runImportPipeline(prisma, {
    year,
    dryRun: Boolean(args.dryRun),
    skipBasic: Boolean(args.skipBasic),
    skipTickets: Boolean(args.skipTickets),
    skipDefects: Boolean(args.skipDefects),
    skipSafety: Boolean(args.skipSafety),
    basicFile: args.basic ? String(args.basic) : undefined,
    ticketFile: args.tickets ? String(args.tickets) : undefined,
    defectFile: args.defects ? String(args.defects) : undefined,
    safetyFile: args.safety ? String(args.safety) : undefined,
    unitFilter: args.unit ? String(args.unit) : undefined,
  });

  if (result.basic) {
    console.log('--- 基本素质 ---');
    console.log(`  员工 ${result.basic.employeeCount}, 事实 ${result.basic.basicFactsWritten}`);
  }
  if (result.tickets) {
    console.log('--- 两票 ---');
    console.log(`  员工 ${result.tickets.employeeCount}, 未匹配 ${result.tickets.unmatchedTotal}`);
  }
  if (result.defects) {
    console.log('--- 缺陷 ---');
    console.log(`  事实 ${result.defects.factCount}, 未匹配 ${result.defects.unmatchedTotal}`);
  }
  if (result.safety) {
    console.log('--- 安全贡献 ---');
    console.log(
      `  条目 ${result.safety.entries}, 事实 ${result.safety.factCount}（第一发现人 ${result.safety.firstDiscoverers}/共同 ${result.safety.coDiscoverers}）, 员工 ${result.safety.employeeCount}, 未匹配 ${result.safety.unmatchedTotal}`,
    );
  }
  if (result.coverage) {
    console.log('--- 覆盖率 ---', result.coverage);
  }
  console.log(`--- 名册内未匹配 ${result.unmatched.inRoster.length} ---`);
  for (const u of result.unmatched.inRoster.slice(0, 10)) {
    console.log(`  ${u.name} (${u.reason}) 候选: ${u.candidateEmployeeNos?.join(',')}`);
  }
  console.log('完成。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
