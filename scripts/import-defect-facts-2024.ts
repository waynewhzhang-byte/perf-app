/**
 * 将「2024年500千伏变电站缺陷库（消缺名单）」导入为
 * 工作现场 → 缺陷治理 维度事实，按工号 employeeNo 归集。
 *
 * 用法：
 *   pnpm import:defect-facts
 *   pnpm import:defect-facts -- --roster ./data/employee-roster.csv --dry-run
 *   pnpm import:defect-facts -- --year 2024 --file ./缺陷库.xlsx
 */
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { readXlsxFirstSheet } from '../src/lib/xlsx-reader';
import { importDefectGovernanceFacts, type DefectRow } from '../src/lib/defect-governance';
import { createEmployeeResolver } from '../src/lib/employee-resolver';
import { DEFECT_LIBRARY_DIMENSION } from '../src/lib/evaluation-dimensions';

const DEFAULT_FILE = '超高压变电--2024年500千伏变电站缺陷库（消缺名单）.xlsx';
const DEFAULT_YEAR = 2024;

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--year' && argv[i + 1]) args.year = argv[++i];
    else if (a === '--file' && argv[i + 1]) args.file = argv[++i];
    else if (a === '--roster' && argv[i + 1]) args.roster = argv[++i];
    else if (a === '--no-db') args.noDb = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = Number(args.year ?? DEFAULT_YEAR);
  const filePath = resolve(String(args.file ?? DEFAULT_FILE));
  const rosterFile = args.roster ? resolve(String(args.roster)) : undefined;
  const dryRun = Boolean(args.dryRun);

  console.log('=== 缺陷库 → 缺陷治理维度 事实导入 ===');
  console.log(`维度确认: ${DEFECT_LIBRARY_DIMENSION.title}（${DEFECT_LIBRARY_DIMENSION.code}，满分 ${DEFECT_LIBRARY_DIMENSION.maxScore}）`);
  console.log(`所属评价维度: 工作现场（42分）`);
  console.log(`评价依据: ${DEFECT_LIBRARY_DIMENSION.evidenceSource}`);
  console.log(`源文件: ${filePath}`);
  console.log(`评价年度: ${year}`);
  if (rosterFile) console.log(`工号名册: ${rosterFile}`);
  console.log(`模式: ${dryRun ? '试运行（不写库）' : '写入 PerformanceFact'}`);
  console.log('');

  const sheet = readXlsxFirstSheet(filePath);
  const rows = sheet.rows as DefectRow[];
  const resolver = await createEmployeeResolver({
    rosterFile,
    useDatabase: !args.noDb,
  });

  const result = importDefectGovernanceFacts(rows, year, resolver);
  const resolverStats = resolver.stats();

  console.log(result.filterNote);
  console.log('');
  console.log(`事实条数: ${result.facts.length}`);
  console.log(`涉及员工（工号）: ${result.byEmployee.length}`);
  console.log(`未匹配姓名: ${result.unmatchedNames.length}`);
  console.log(`解析器: 名册+库共 ${resolverStats.rosterSize} 条姓名映射，数据库用户 ${resolverStats.dbUsers}`);
  if (resolverStats.ambiguousNames.length > 0) {
    console.log(`重名歧义（已跳过）: ${resolverStats.ambiguousNames.slice(0, 10).join('、')}`);
  }
  console.log('');

  if (result.byEmployee.length > 0) {
    console.log('--- 员工维度汇总（前 15）---');
    for (const row of result.byEmployee.slice(0, 15)) {
      console.log(
        `${row.employeeNo}\t${row.employeeName}\t原始 ${row.rawScore}\t封顶 ${row.cappedScore}\t${row.factCount} 条事实`,
      );
    }
    console.log('');
  }

  if (result.unmatchedNames.length > 0) {
    console.log('--- 未匹配姓名（需提供工号名册）---');
    for (const u of result.unmatchedNames.slice(0, 20)) {
      console.log(`${u.name}\t${u.occurrences} 次\t示例 ${u.sampleDefectRefs.join(', ')}`);
    }
    console.log('');
  }

  const outDir = resolve('data/imported');
  mkdirSync(outDir, { recursive: true });
  const outJson = resolve(outDir, `defect-governance-${year}.json`);
  writeFileSync(outJson, JSON.stringify(result, null, 2), 'utf8');
  console.log(`已写出: ${outJson}`);

  if (dryRun) {
    console.log('试运行结束，未写入数据库。');
    return;
  }

  const users = await prisma.user.findMany({
    where: { employeeNo: { in: result.byEmployee.map((e) => e.employeeNo) } },
    select: { id: true, employeeNo: true },
  });
  const userIdByNo = new Map(users.map((u) => [u.employeeNo!, u.id]));

  await prisma.performanceFact.deleteMany({
    where: { year, dimensionCode: DEFECT_LIBRARY_DIMENSION.code, sourceFile: filePath },
  });

  let inserted = 0;
  for (const fact of result.facts) {
    await prisma.performanceFact.create({
      data: {
        year: fact.year,
        employeeNo: fact.employeeNo,
        employeeName: fact.employeeName,
        userId: userIdByNo.get(fact.employeeNo) ?? null,
        dimensionCode: fact.dimensionCode,
        dimensionTitle: fact.dimensionTitle,
        role: fact.role,
        eventType: fact.eventType,
        score: new Prisma.Decimal(fact.score),
        defectRef: fact.defectRef,
        defectLevel: fact.defectLevel,
        eventDate: fact.eventDate,
        sourceFile: filePath,
        metadata: fact.metadata,
      },
    });
    inserted += 1;
  }

  console.log(`已写入 PerformanceFact: ${inserted} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
