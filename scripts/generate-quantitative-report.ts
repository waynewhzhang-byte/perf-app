/**
 * 从 2024 缺陷库生成「量化积分表积分报送表」格式 Excel：
 * - 自动为姓名生成随机工号
 * - 按暂行稿缺陷治理规则计分
 * - 输出结构与「超高压变电--量化积分表积分报送表.（变电检修中心） - 上报.xlsx」一致
 *
 * 用法：
 *   pnpm generate:quantitative-report
 *   pnpm generate:quantitative-report -- --import-db
 */
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { readXlsxFirstSheet } from '../src/lib/xlsx-reader';
import { importDefectGovernanceFacts, type DefectRow } from '../src/lib/defect-governance';
import { DEFECT_LIBRARY_DIMENSION, SAFETY_CONTRIBUTION_DIMENSION, TICKET_EXECUTION_DIMENSION } from '../src/lib/evaluation-dimensions';
import { loadTicketExecutionFromFile } from '../src/lib/ticket-execution';
import {
  collectPersonNamesFromContributionEntries,
  importSafetyContributionFacts,
  loadSafetyContributionFromFile,
} from '../src/lib/safety-contribution';
import {
  buildRandomRoster,
  collectPersonNamesFromDefectRows,
  writeRosterCsv,
  createRosterResolver,
} from '../src/lib/random-roster';
import { buildQuantitativeReportBundle } from '../src/lib/quantitative-report';
import { writeQuantitativeReportXlsx } from '../src/lib/quantitative-report-xlsx';

const DEFAULT_DEFECT_FILE = '超高压变电--2024年500千伏变电站缺陷库（消缺名单）.xlsx';
const DEFAULT_TICKET_FILE = '公共佐证-两票公示汇总-2024.xls';
const DEFAULT_CONTRIBUTION_FILE = '2024年突出贡献奖明细表.xlsx';
const DEFAULT_OUTPUT =
  'data/generated/超高压变电--量化积分表积分报送表.（变电检修中心）-自动生成.xlsx';
const DEFAULT_YEAR = 2024;
const DEFAULT_UNIT = '变电检修中心';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = { importDb: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--import-db') args.importDb = true;
    else if (a === '--year' && argv[i + 1]) args.year = argv[++i];
    else if (a === '--file' && argv[i + 1]) args.file = argv[++i];
    else if (a === '--ticket-file' && argv[i + 1]) args.ticketFile = argv[++i];
    else if (a === '--contribution-file' && argv[i + 1]) args.contributionFile = argv[++i];
    else if (a === '--no-ticket') args.noTicket = true;
    else if (a === '--no-contribution') args.noContribution = true;
    else if (a === '--output' && argv[i + 1]) args.output = argv[++i];
    else if (a === '--unit' && argv[i + 1]) args.unit = argv[++i];
  }
  return args;
}

async function importFactsToDb(
  filePath: string,
  year: number,
  dimensionCode: string,
  facts: {
    year: number;
    employeeNo: string;
    employeeName: string;
    dimensionCode: string;
    dimensionTitle: string;
    role: string;
    score: number;
    eventType?: 'DISCOVERY' | 'REMEDIATION';
    defectRef: string | null;
    defectLevel: string | null;
    eventDate: string | null;
    metadata: Record<string, unknown>;
  }[],
  userIdByNo: Map<string, string>,
) {
  await prisma.performanceFact.deleteMany({
    where: { year, dimensionCode, sourceFile: filePath },
  });

  for (const fact of facts) {
    await prisma.performanceFact.create({
      data: {
        year: fact.year,
        employeeNo: fact.employeeNo,
        employeeName: fact.employeeName,
        userId: userIdByNo.get(fact.employeeNo) ?? null,
        dimensionCode: fact.dimensionCode,
        dimensionTitle: fact.dimensionTitle,
        role: fact.role,
        eventType: fact.eventType ?? 'DISCOVERY',
        score: new Prisma.Decimal(fact.score),
        defectRef: fact.defectRef,
        defectLevel: fact.defectLevel,
        eventDate: fact.eventDate,
        sourceFile: filePath,
        metadata: fact.metadata,
      },
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = Number(args.year ?? DEFAULT_YEAR);
  const unit = String(args.unit ?? DEFAULT_UNIT);
  const defectFile = resolve(String(args.file ?? DEFAULT_DEFECT_FILE));
  const ticketFile = args.noTicket ? null : resolve(String(args.ticketFile ?? DEFAULT_TICKET_FILE));
  const contributionFile = args.noContribution
    ? null
    : resolve(String(args.contributionFile ?? DEFAULT_CONTRIBUTION_FILE));
  const outputPath = resolve(String(args.output ?? DEFAULT_OUTPUT));
  const rosterPath = resolve('data/generated/employee-roster-auto.csv');

  console.log('=== 缺陷库 → 量化积分报送表 生成 ===');
  console.log(`源缺陷库: ${defectFile}`);
  console.log(`报送单位: ${unit}`);
  console.log(`评价维度: 工作现场 → 缺陷治理（满分 ${DEFECT_LIBRARY_DIMENSION.maxScore}）`);
  if (ticketFile) {
    console.log(`两票汇总: ${ticketFile}`);
    console.log(`两票维度: 工作现场 → 两票执行（满分 ${TICKET_EXECUTION_DIMENSION.maxScore}，按能级比例折算）`);
  }
  if (contributionFile) {
    console.log(`突出贡献: ${contributionFile}`);
    console.log(
      `安全贡献: 工作业绩 → 安全贡献（满分 ${SAFETY_CONTRIBUTION_DIMENSION.maxScore}，按申报编号计分）`,
    );
  }
  console.log(`评价年度: ${year}`);
  console.log('');

  const sheet = readXlsxFirstSheet(defectFile);
  const defectRows = sheet.rows as DefectRow[];

  const contributionParsed = contributionFile
    ? loadSafetyContributionFromFile(contributionFile, { year, unit })
    : null;

  const defectNames = collectPersonNamesFromDefectRows(defectRows);
  const contributionNames = contributionParsed
    ? collectPersonNamesFromContributionEntries(contributionParsed.entries)
    : [];
  const names = [...new Set([...defectNames, ...contributionNames])].sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
  const roster = buildRandomRoster(names);
  writeRosterCsv(roster, rosterPath);
  console.log(`已生成工号名册: ${rosterPath}（${roster.length} 人）`);

  const resolver = createRosterResolver(roster);
  const defectImport = importDefectGovernanceFacts(defectRows, year, resolver);

  const ticketImport = ticketFile ? loadTicketExecutionFromFile(ticketFile, unit) : undefined;
  if (ticketImport) {
    console.log(`两票统计表: ${ticketImport.entries.length} 人（${unit}）`);
  }

  const safetyImport = contributionParsed
    ? importSafetyContributionFacts(contributionParsed, year, resolver)
    : undefined;
  if (safetyImport) {
    console.log(`安全贡献: ${safetyImport.byEmployee.length} 人，事实 ${safetyImport.facts.length} 条`);
  }

  const bundle = buildQuantitativeReportBundle(defectImport, defectRows, {
    year,
    reportTitleYear: year + 1,
    unit,
    rosterCsvPath: rosterPath,
    ticketImport,
    safetyImport,
  });

  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  await writeQuantitativeReportXlsx(bundle, outputPath);

  const summaryPath = resolve('data/generated/quantitative-report-summary.json');
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        outputPath,
        rosterPath,
        year,
        unit,
        dimension: DEFECT_LIBRARY_DIMENSION,
        ticketDimension: ticketImport ? TICKET_EXECUTION_DIMENSION : null,
        safetyDimension: safetyImport ? SAFETY_CONTRIBUTION_DIMENSION : null,
        ticketScalingNote: bundle.ticketScalingNote,
        safetyFilterNote: safetyImport?.filterNote ?? null,
        filterNote: defectImport.filterNote,
        employeeCount: bundle.rows.length,
        factCount: defectImport.facts.length,
        safetyFactCount: safetyImport?.facts.length ?? 0,
        tiers: {
          一级: bundle.byTier.一级.length,
          二级: bundle.byTier.二级.length,
          三级: bundle.byTier.三级.length,
        },
        topEmployees: bundle.rows.slice(0, 10).map((r) => ({
          employeeNo: r.employeeNo,
          fullName: r.fullName,
          defectGovernance: r.defectGovernance,
          safetyContribution: r.safetyContribution,
          ticketExecution: r.ticketExecution,
          rawTicketScore: r.rawTicketScore,
          tier: r.tier,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('');
  console.log(defectImport.filterNote);
  console.log(`事实条数: ${defectImport.facts.length}`);
  console.log(`报送员工: ${bundle.rows.length}（缺陷或安全贡献 > 0）`);
  console.log(`能级分组: 一级 ${bundle.byTier.一级.length} / 二级 ${bundle.byTier.二级.length} / 三级 ${bundle.byTier.三级.length}`);
  console.log('');
  console.log('--- 缺陷治理 TOP 10 ---');
  for (const r of bundle.rows.slice(0, 10)) {
    console.log(
      `${r.employeeNo}\t${r.fullName}\t缺陷 ${r.defectGovernance}\t安全 ${r.safetyContribution}\t两票 ${r.ticketExecution}\t${r.tier}`,
    );
  }
  if (ticketImport) {
    const tierMax = {
      一级: Math.max(0, ...bundle.rows.filter((r) => r.tier === '一级').map((r) => r.rawTicketScore)),
      二级: Math.max(0, ...bundle.rows.filter((r) => r.tier === '二级').map((r) => r.rawTicketScore)),
      三级: Math.max(0, ...bundle.rows.filter((r) => r.tier === '三级').map((r) => r.rawTicketScore)),
    };
    console.log('');
    console.log('--- 各能级两票原始最高分 ---');
    console.log(`一级 ${tierMax.一级} → 30 分封顶 | 二级 ${tierMax.二级} | 三级 ${tierMax.三级}`);
  }
  console.log('');
  console.log(`已写出报送表: ${outputPath}`);
  console.log(`已写出摘要: ${summaryPath}`);
  console.log('工作表: 一级 / 二级 / 三级 / 积分规则 / 缺陷明细与计分 / 安全贡献明细 / 工号名册');

  if (args.importDb) {
    const employeeNos = [
      ...new Set([
        ...defectImport.byEmployee.map((e) => e.employeeNo),
        ...(safetyImport?.byEmployee.map((e) => e.employeeNo) ?? []),
      ]),
    ];
    const users = await prisma.user.findMany({
      where: { employeeNo: { in: employeeNos } },
      select: { id: true, employeeNo: true },
    });
    const userIdByNo = new Map(users.map((u) => [u.employeeNo!, u.id]));

    await importFactsToDb(
      defectFile,
      year,
      DEFECT_LIBRARY_DIMENSION.code,
      defectImport.facts.map((fact) => ({
        year: fact.year,
        employeeNo: fact.employeeNo,
        employeeName: fact.employeeName,
        dimensionCode: fact.dimensionCode,
        dimensionTitle: fact.dimensionTitle,
        role: fact.role,
        eventType: fact.eventType,
        score: fact.score,
        defectRef: fact.defectRef,
        defectLevel: fact.defectLevel,
        eventDate: fact.eventDate,
        metadata: fact.metadata as Record<string, unknown>,
      })),
      userIdByNo,
    );
    console.log(`已同步 PerformanceFact（缺陷）: ${defectImport.facts.length} 条`);

    if (safetyImport && contributionFile) {
      await importFactsToDb(
        contributionFile,
        year,
        SAFETY_CONTRIBUTION_DIMENSION.code,
        safetyImport.facts.map((fact) => ({
          year: fact.year,
          employeeNo: fact.employeeNo,
          employeeName: fact.employeeName,
          dimensionCode: fact.dimensionCode,
          dimensionTitle: fact.dimensionTitle,
          role: fact.role,
          eventType: 'DISCOVERY',
          score: fact.score,
          defectRef: fact.incidentRef,
          defectLevel: fact.defectLevel ?? '',
          eventDate: fact.eventDate,
          metadata: fact.metadata as Record<string, unknown>,
        })),
        userIdByNo,
      );
      console.log(`已同步 PerformanceFact（安全贡献）: ${safetyImport.facts.length} 条`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
