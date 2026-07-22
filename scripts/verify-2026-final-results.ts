#!/usr/bin/env npx tsx
/**
 * 2026 正式结果审计：原始 XLSX → PerformanceFact / EmployeeBasicFact。
 *
 * 每个绩效维度按「员工 + 维度」校验事实条数与原始分；基本素质逐人逐项校验。
 * 这不是对导出文件的循环校验，期望值均由原始表重新解析并按评分标准构造。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { prisma } from '@/lib/prisma';
import { loadMatrix, loadSheet } from '@/lib/verify/source-loader';
import { checkPerformanceLevel, checkSkillLevel, checkTitleLevel, summarize, type BasicFactRow } from '@/lib/verify/dimension-checks';
import { createRosterResolverFromUsers } from '@/lib/roster-resolver';
import { aggregateTicketExecutionRows, mergeWorkMemberTicketScores, type WorkMemberRow } from '@/lib/ticket-execution-import';
import { buildFactsFromDefectRows, type DefectRow } from '@/lib/defect-governance';
import { buildCompetitionSeeds } from '@/lib/competition-import';
import { buildPatentSeeds, parsePatentRows } from '@/lib/patent-import';
import { buildViolationSeeds } from '@/lib/violation-import';
import { batchComputeImportedScores } from '@/lib/imported-score-batch';

const YEAR = 2026;
const DATA_DIR = '20260716超高压人员信息表';
type ExpectedFact = { employeeNo: string; dimensionCode: string; score: number };
type DimensionResult = { dimension: string; expectedCount: number; dbCount: number; mismatches: string[]; ok: boolean };

function rowsFromMatrix(file: string, headerRow: number): Record<string, string>[] {
  const matrix = loadMatrix(file);
  const headers = matrix[headerRow] ?? [];
  return matrix.slice(headerRow + 1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function aggregateFacts(facts: ExpectedFact[]) {
  const map = new Map<string, { count: number; score: number }>();
  for (const fact of facts) {
    const key = `${fact.dimensionCode}\u0000${fact.employeeNo}`;
    const value = map.get(key) ?? { count: 0, score: 0 };
    value.count += 1;
    value.score = Math.round((value.score + fact.score) * 100) / 100;
    map.set(key, value);
  }
  return map;
}

function compareFacts(dimension: string, expected: ExpectedFact[], dbFacts: ExpectedFact[]): DimensionResult {
  const wanted = aggregateFacts(expected.filter((fact) => fact.dimensionCode === dimension));
  const actual = aggregateFacts(dbFacts.filter((fact) => fact.dimensionCode === dimension));
  const keys = new Set([...wanted.keys(), ...actual.keys()]);
  const mismatches = [...keys].flatMap((key) => {
    const source = wanted.get(key) ?? { count: 0, score: 0 };
    const db = actual.get(key) ?? { count: 0, score: 0 };
    if (source.count === db.count && Math.abs(source.score - db.score) < 0.001) return [];
    const [, employeeNo] = key.split('\u0000');
    return [`${employeeNo}: 源 ${source.count} 条/${source.score} 分，DB ${db.count} 条/${db.score} 分`];
  });
  return { dimension, expectedCount: expected.filter((fact) => fact.dimensionCode === dimension).length, dbCount: dbFacts.filter((fact) => fact.dimensionCode === dimension).length, mismatches, ok: mismatches.length === 0 };
}

/**
 * 审计口径独立于导入器：源表“项目”列的明确层级优先于奖项名称中的赛事名称。
 * 这样导入判定回归时，审计不会与生产代码共同掩盖错误。
 */
function innovationScoreFromSource(award: string, sourceLevel: string): number {
  const levelKey = /省公司/.test(sourceLevel)
    ? 'sheng'
    : /国网|国家电网|全国/.test(sourceLevel)
      ? 'guowang'
      : /国网|国家电网|全国/.test(award)
        ? 'guowang'
        : 'sheng';
  const isQcOrWuxiao = /QC|五小/.test(award);
  if (isQcOrWuxiao) return levelKey === 'guowang' ? 4 : 2;
  return levelKey === 'guowang' ? 5 : 3;
}

async function main() {
  const users = await prisma.user.findMany({ where: { employeeNo: { not: null } }, select: { employeeNo: true, fullName: true } });
  const byEmployeeNo = new Map(users.map((user) => [user.employeeNo!, user]));
  const rosterEmployeeNos = new Set(byEmployeeNo.keys());
  const resolver = createRosterResolverFromUsers(users.map((user) => ({ employeeNo: user.employeeNo!, fullName: user.fullName })));
  const defectSourceRows = loadSheet(`${DATA_DIR}/14.问题清单数据2025年(277条).xlsx`).rows;
  const defectNameByNo = new Map<string, string>();
  for (const row of defectSourceRows) {
    for (const [nameColumn, noColumn] of [['第一发现人', '员工编号'], ['其他共同发现人', '员工编号_1'], ['第一消缺人员', '员工编号_2'], ['其他共同消缺人员', '员工编号_3']] as const) {
      if (row[noColumn]) defectNameByNo.set(row[noColumn], row[nameColumn] || row[noColumn]);
    }
  }
  const resolverWithSourceNo = { resolve(name: string) { const user = byEmployeeNo.get(name); if (user) return { employeeNo: user.employeeNo!, employeeName: user.fullName }; if (defectNameByNo.has(name)) return { employeeNo: name, employeeName: defectNameByNo.get(name)! }; return resolver.resolve(name); } };
  const resolveWithNo = { resolve(name: string, employeeNo?: string) { const user = employeeNo ? byEmployeeNo.get(employeeNo) : undefined; return user ? { employeeNo: user.employeeNo!, employeeName: user.fullName } : resolver.resolve(name); } };

  const expected: ExpectedFact[] = [];
  const add = (dimensionCode: string, rows: Array<{ employeeNo: string; score: number }>) => rows.forEach((row) => expected.push({ ...row, dimensionCode }));

  // 两票：四份源表聚合；名册外参与人不属于本年度 435 人评价范围。
  const operationRows = loadSheet(`${DATA_DIR}/10.2025操作票（1013条）.xlsx`).rows;
  const workRows = loadSheet(`${DATA_DIR}/11.2025工作票（853条）.xlsx`).rows;
  const memberRows: WorkMemberRow[] = [
    ...loadSheet(`${DATA_DIR}/12.工作班成员工作票二种表（1965人）.xlsx`).rows,
    ...loadSheet(`${DATA_DIR}/13.工作班成员工作票一种表（720人）.xlsx`).rows,
  ].map((row) => ({ 票类型: row['票类型'], 姓名: row['姓名'], 人员编号: row['人员编号'] }));
  const ticket = aggregateTicketExecutionRows(operationRows, workRows, resolveWithNo);
  const ticketExpected = mergeWorkMemberTicketScores(ticket.aggregates, memberRows).filter((row) => byEmployeeNo.has(row.employeeNo));
  add('worksite.ticket-execution', ticketExpected.map((row) => ({ employeeNo: row.employeeNo, score: row.rawScore })));

  // 缺陷和安全：直接复用与生产导入相同的源表解析与评分规则；
  // 仅核验 435 人评价花名册，源表里的名册外参与人不属于本年度评价范围。
  const defectRows = defectSourceRows.map((row) => ({
    ...row,
    发现人: [row['员工编号'] || row['第一发现人'], row['员工编号_1'] || row['其他共同发现人']].filter(Boolean).join('、'),
    消缺人: [row['员工编号_2'] || row['第一消缺人员'], row['员工编号_3'] || row['其他共同消缺人员']].filter(Boolean).join('、'),
  }));
  // 源表为 2025 年度发生记录，评价年度 2026 使用该完整年度事实。
  const defects = buildFactsFromDefectRows(defectRows as DefectRow[], 2025, resolverWithSourceNo);
  add('worksite.defect-governance', defects.facts
    .filter((row) => rosterEmployeeNos.has(row.employeeNo))
    .map((row) => ({ employeeNo: row.employeeNo, score: row.score })));
  const safetyGroups = new Map<string, Array<{ employeeNo: string; first: boolean }>>();
  for (const row of loadMatrix(`${DATA_DIR}/3.突出贡献奖人员汇总(43人).xlsx`).slice(2)) {
    const employeeNo = row[2]?.trim();
    const reason = row[15]?.trim();
    if (!employeeNo || !reason) continue;
    const group = safetyGroups.get(reason) ?? [];
    group.push({ employeeNo, first: row[12]?.trim() === '第一发现人' });
    safetyGroups.set(reason, group);
  }
  for (const group of safetyGroups.values()) {
    const coCount = group.filter((row) => !row.first).length;
    for (const row of group) add('performance.safety-contribution', [{ employeeNo: row.employeeNo, score: row.first ? 3 : 3 / coCount }]);
  }

  // 技术贡献：源表每名参与者按评分标准固定得分。
  for (const [file, dimensionCode, score] of [
    ['4.参加公司级及以上教材编制、题库开发、课件开发人员名单（5人）.xlsx', 'performance.technical-contribution.textbook', 3],
    ['5.《两票》参与修订人员、审查人员（19人）.xlsx', 'performance.technical-contribution.ticket-revision', 2],
  ] as const) {
    const rows = rowsFromMatrix(`${DATA_DIR}/${file}`, 2);
    add(dimensionCode, rows.filter((row) => row['人员编号']).map((row) => ({ employeeNo: row['人员编号'], score })));
  }
  const regulationMatrix = loadMatrix(`${DATA_DIR}/6.《运规》编写 会审人员（135人）.xlsx`, 'Sheet1');
  add('performance.technical-contribution.regulation', regulationMatrix.slice(3).filter((row) => row[0]).map((row) => ({ employeeNo: row[2], score: 2 })));

  const competitionRows = rowsFromMatrix(`${DATA_DIR}/7.竞赛比武（4人）.xlsx`, 1);
  add('performance.competition.competition', buildCompetitionSeeds(competitionRows, { employeeNo: '人员编号', employeeName: '姓名', award: '奖项', level: '项目', category: '项目' }, YEAR).filter((row) => row.dimensionCode === 'performance.competition.competition').map((row) => ({ employeeNo: row.employeeNo, score: Number(row.score) })));
  add('performance.competition.exam', buildCompetitionSeeds(competitionRows, { employeeNo: '人员编号', employeeName: '姓名', award: '奖项', level: '项目', category: '项目' }, YEAR).filter((row) => row.dimensionCode === 'performance.competition.exam').map((row) => ({ employeeNo: row.employeeNo, score: Number(row.score) })));

  const innovationRows = rowsFromMatrix(`${DATA_DIR}/8.创新奖项人员总汇（34人）.xlsx`, 1);
  add('performance.innovation.award', innovationRows
    .filter((row) => row['人员编号'])
    .map((row) => ({
      employeeNo: row['人员编号'],
      score: innovationScoreFromSource(row['奖项'] ?? '', row['项目'] ?? ''),
    })));

  const patentMatrix = loadMatrix(`${DATA_DIR}/9.发明专利（10条）.xlsx`);
  const patentRows = patentMatrix.slice(1).filter((row) => row[0]).map((row) => ({ patentName: row[1], 发明人1: row[6], 工号1: row[7], 发明人2: row[8], 工号2: row[9], 发明人3: row[10], 工号3: row[11], 发明人4: row[12], 工号4: row[13] }));
  add('performance.innovation.paper-patent', buildPatentSeeds(parsePatentRows(patentRows, { patentName: 'patentName', inventorCols: ['发明人1', '工号1', '发明人2', '工号2', '发明人3', '工号3', '发明人4', '工号4'] }), YEAR, 'source').map((row) => ({ employeeNo: row.employeeNo, score: Number(row.score) })));

  const violationRows = rowsFromMatrix(`${DATA_DIR}/15.处罚人员名单（1人）.xlsx`, 2);
  for (const seed of buildViolationSeeds(violationRows, { employeeNo: '人员编号', employeeName: '违章人员', level: '所属等级', role: '人员类型', description: '发现的问题', eventDate: '日期' }, YEAR)) add(seed.dimensionCode, [{ employeeNo: seed.employeeNo, score: Number(seed.score) }]);

  const dbRaw = await prisma.performanceFact.findMany({ where: { year: YEAR }, select: { employeeNo: true, dimensionCode: true, score: true } });
  const dbFacts = dbRaw
    .filter((row) => rosterEmployeeNos.has(row.employeeNo))
    .map((row) => ({ employeeNo: row.employeeNo, dimensionCode: row.dimensionCode, score: Number(row.score) }));
  const dimensions = [...new Set([...expected.map((row) => row.dimensionCode), ...dbFacts.map((row) => row.dimensionCode)])].sort();
  const performanceResults = dimensions.map((dimension) => compareFacts(dimension, expected, dbFacts));

  const basicRaw = await prisma.employeeBasicFact.findMany({ where: { year: YEAR }, select: { employeeNo: true, dimension: true, tierValue: true, score: true } });
  const basicFacts: BasicFactRow[] = basicRaw.map((row) => ({ employeeNo: row.employeeNo, dimension: row.dimension, tierValue: row.tierValue, score: Number(row.score) }));
  const basicResults = [
    checkSkillLevel(basicFacts, resolve(DATA_DIR, '1.能级评价员工花名册（435人 含职称 技能等级）.xlsx')),
    checkTitleLevel(basicFacts, resolve(DATA_DIR, '1.能级评价员工花名册（435人 含职称 技能等级）.xlsx')),
    checkPerformanceLevel(basicFacts, resolve(DATA_DIR, '2.人员考核结果（435人）.xlsx')),
  ];
  const calculated = await batchComputeImportedScores(prisma, YEAR, { fetchAll: true, includeSheet: false });
  const calculatedEmployeeNos = new Set(calculated.rows.map((row) => row.employeeNo));
  const factEmployeeNos = new Set([
    ...dbRaw.map((row) => row.employeeNo),
    ...basicRaw.map((row) => row.employeeNo),
  ]);
  const coverage = {
    roster: rosterEmployeeNos.size,
    missingFacts: [...rosterEmployeeNos].filter((employeeNo) => !factEmployeeNos.has(employeeNo)),
    missingScores: [...rosterEmployeeNos].filter((employeeNo) => !calculatedEmployeeNos.has(employeeNo)),
  };
  const exportedRows = loadMatrix('data/generated/2026年导入事实绩效分表.xlsx', '个人分表').slice(1);
  const exportedByNo = new Map(exportedRows.map((row) => [row[1], row]));
  const scoreMismatches = calculated.rows.flatMap((row) => {
    const exported = exportedByNo.get(row.employeeNo);
    if (!exported) return [`${row.employeeNo}: 导出分表缺行`];
    const expectedValues = [row.basicScore, row.ticketScore, row.ticketRawScore ?? 0, row.defectScore, row.defectRawScore ?? 0, row.worksiteScore, -row.deductionScore, row.importedTotalScore, row.finalTotalScore];
    const actualValues = [8, 18, 19, 20, 21, 17, 22, 23, 24].map((index) => Number(exported[index] || 0));
    return expectedValues.some((value, index) => Math.abs(value - actualValues[index]) > 0.001)
      ? [`${row.employeeNo}: 导出积分与系统计算不一致`]
      : [];
  });
  if (exportedRows.length !== calculated.total) scoreMismatches.push(`导出人数 ${exportedRows.length}，系统计算人数 ${calculated.total}`);
  const allOk = performanceResults.every((result) => result.ok)
    && basicResults.every((result) => result.ok)
    && scoreMismatches.length === 0
    && coverage.missingFacts.length === 0
    && coverage.missingScores.length === 0;
  for (const result of performanceResults) console.log(`${result.ok ? '✓' : '✗'} ${result.dimension}: 源 ${result.expectedCount} / DB ${result.dbCount} / 不匹配 ${result.mismatches.length}`);
  for (const result of basicResults) console.log(`${result.ok ? '✓' : '✗'} ${result.dimension}: 源 ${result.expectedCount} / DB ${result.dbCount} / 不匹配 ${result.mismatches.length}`);
  console.log(`${scoreMismatches.length === 0 ? '✓' : '✗'} 最终积分导出: 系统 ${calculated.total} / XLSX ${exportedRows.length} / 不匹配 ${scoreMismatches.length}`);
  console.log(`${coverage.missingFacts.length === 0 && coverage.missingScores.length === 0 ? '✓' : '✗'} 花名册覆盖: ${coverage.roster} 人 / 缺事实 ${coverage.missingFacts.length} / 缺绩效分 ${coverage.missingScores.length}`);
  const report = { year: YEAR, ok: allOk, performanceResults, basic: summarize(basicResults), finalScoreExport: { computed: calculated.total, exported: exportedRows.length, mismatches: scoreMismatches }, coverage, ticketUnmatchedNames: ticket.unmatchedNames, defectUnmatchedNames: [...defects.unmatchedNameMap.keys()] };
  const reportPath = resolve('data/generated', `verify-final-results-${YEAR}-${Date.now()}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`报告: ${reportPath}`);
  if (!allOk) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
