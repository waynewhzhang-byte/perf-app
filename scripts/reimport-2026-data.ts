#!/usr/bin/env npx tsx
/**
 * 2026 数据重导入 CLI（一次性，修 B1/B2/B3 旧 buggy 数据）。
 *
 * 调用 src/lib/*-import.ts 的 batch-replace seam，不直写 DB。
 * 用法：
 *   npx tsx scripts/reimport-2026-data.ts --dimension patent
 *   npx tsx scripts/reimport-2026-data.ts --dimension tech-regulation
 *   npx tsx scripts/reimport-2026-data.ts --dimension tickets
 *   npx tsx scripts/reimport-2026-data.ts --all
 */
import { prisma } from '../src/lib/prisma';
import { loadMatrix, loadSheet } from '@/lib/verify/source-loader';
import { importPatentFacts } from '@/lib/patent-import';
import { importTechContribFacts } from '@/lib/tech-contrib-import';
import { importCompetitionFacts } from '@/lib/competition-import';
import { importInnovationFacts } from '@/lib/innovation-import';
import { importViolationFacts } from '@/lib/violation-import';
import { buildFactsFromDefectRows, type DefectRow } from '@/lib/defect-governance';
import { persistSeedsBySource } from '@/lib/fact-import-common';
import {
  aggregateTicketExecutionRows,
  buildWorkMemberTicketRecords,
  mergeWorkMemberTicketScores,
  type WorkMemberRow,
} from '@/lib/ticket-execution-import';
import { createRosterResolverFromUsers } from '@/lib/roster-resolver';
import { loadUserIdByEmployeeNo, persistTicketRecords } from '@/lib/fact-import-persistence';
import { importScoreFacts, loadScoringRule } from '@/lib/manual-fact-import';
import {
  compareEmployeeScoreTotals,
  EmployeeScoreTotalsMismatchError,
} from '@/lib/performance-fact-repository';

const DATA_DIR = '20260716超高压人员信息表';

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function rowsFromMatrix(filePath: string, headerRow: number): Record<string, string>[] {
  const matrix = loadMatrix(filePath);
  const headers = matrix[headerRow] ?? [];
  return matrix.slice(headerRow + 1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row, index) => ({
      ...Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ''])),
      __sourceRowNo: String(headerRow + index + 2),
    }));
}

async function reimportInnovation() {
  console.log('--- 重导入创新奖项（按源表项目列的获奖层级计分）---');
  const filePath = `${DATA_DIR}/8.创新奖项人员总汇（34人）.xlsx`;
  const result = await importInnovationFacts(prisma, 2026, filePath, rowsFromMatrix(filePath, 1), {
    employeeNo: '人员编号', employeeName: '姓名', award: '奖项', level: '项目', project: '备注',
  }, { replaceAcrossSourceFiles: true, preserveEmployeeScoreTotals: true });
  console.log(JSON.stringify(result));
}

async function reimportSafetyContribution() {
  console.log('--- 重导入安全贡献（完整奖惩源行）---');
  const filePath = `${DATA_DIR}/3.突出贡献奖人员汇总(43人).xlsx`;
  const result = await importScoreFacts(
    prisma,
    'performance.safety-contribution',
    '安全贡献',
    2026,
    {
      employeeNo: '人员编号',
      employeeName: '姓名',
      role: '安全周期奖类型',
      incidentId: '事由',
      eventDate: '时间',
    },
    rowsFromMatrix(filePath, 1),
    filePath,
    { replaceAcrossSourceFiles: true, preserveEmployeeScoreTotals: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportCompetition() {
  console.log('--- 重导入竞赛比武/调考（完整获奖源行）---');
  const filePath = `${DATA_DIR}/7.竞赛比武（4人）.xlsx`;
  const result = await importCompetitionFacts(
    prisma,
    2026,
    filePath,
    rowsFromMatrix(filePath, 1),
    {
      employeeNo: '人员编号',
      employeeName: '姓名',
      award: '奖项',
      level: '项目',
      category: '备注',
    },
    { replaceAcrossSourceFiles: true, preserveEmployeeScoreTotals: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportViolation() {
  console.log('--- 重导入违章扣分（完整处罚源行）---');
  const filePath = `${DATA_DIR}/15.处罚人员名单（1人）.xlsx`;
  const result = await importViolationFacts(
    prisma,
    2026,
    filePath,
    rowsFromMatrix(filePath, 2),
    {
      employeeNo: '人员编号',
      employeeName: '违章人员',
      level: '所属等级',
      role: '人员类型',
      description: '发现的问题',
      eventDate: '日期',
    },
    { replaceAcrossSourceFiles: true, preserveEmployeeScoreTotals: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportDefects() {
  console.log('--- 重导入缺陷治理（完整多人/发现/消缺事实）---');
  const filePath = `${DATA_DIR}/14.问题清单数据2025年(277条).xlsx`;
  const users = await prisma.user.findMany({ where: { employeeNo: { not: null } }, select: { employeeNo: true, fullName: true } });
  const resolver = createRosterResolverFromUsers(users.map((user) => ({ employeeNo: user.employeeNo!, fullName: user.fullName })));
  const userByNo = new Map(users.map((user) => [user.employeeNo!, user]));
  const sourceNameByNo = new Map<string, string>();
  const sourceRows = loadSheet(filePath).rows;
  for (const row of sourceRows) {
    for (const [nameColumn, noColumn] of [['第一发现人', '员工编号'], ['其他共同发现人', '员工编号_1'], ['第一消缺人员', '员工编号_2'], ['其他共同消缺人员', '员工编号_3']] as const) {
      if (row[noColumn]) sourceNameByNo.set(row[noColumn], row[nameColumn] || row[noColumn]);
    }
  }
  const resolverWithSourceNo = {
    resolve(name: string) {
      const user = userByNo.get(name);
      if (user) return { employeeNo: user.employeeNo!, employeeName: user.fullName };
      if (sourceNameByNo.has(name)) return { employeeNo: name, employeeName: sourceNameByNo.get(name)! };
      return resolver.resolve(name);
    },
  };
  const rows = sourceRows.map((row) => ({
    ...row,
    // 缺陷表已经提供各角色工号；优先用它，避免同名员工被姓名解析遗漏。
    发现人: [row['员工编号'] || row['第一发现人'], row['员工编号_1'] || row['其他共同发现人']].filter(Boolean).join('、'),
    消缺人: [row['员工编号_2'] || row['第一消缺人员'], row['员工编号_3'] || row['其他共同消缺人员']].filter(Boolean).join('、'),
  }));
  const imported = buildFactsFromDefectRows(
    rows as DefectRow[],
    2025,
    resolverWithSourceNo,
    {},
    await loadScoringRule(prisma, 'worksite.defect-governance'),
  );
  const result = await persistSeedsBySource(prisma, {
    year: 2026,
    dimensionCode: 'worksite.defect-governance',
    sourceFile: filePath,
    replaceAcrossSourceFiles: true,
    preserveEmployeeScoreTotals: true,
  }, imported.facts.map((fact) => ({ ...fact, year: 2026 })));
  console.log(JSON.stringify({
    sourceRows: rows.length,
    importedFacts: imported.facts.length,
    unmatchedNames: [...imported.unmatchedNameMap.entries()].map(([name, value]) => ({ name, occurrences: value.count, sampleRefs: [...value.refs].slice(0, 5) })),
    outsideRosterFactEmployeeNos: imported.facts.filter((fact) => !userByNo.has(fact.employeeNo)).map((fact) => fact.employeeNo),
    result,
  }));
}

async function reimportPatents() {
  console.log('--- 重导入发明专利（B3 修复）---');
  const filePath = `${DATA_DIR}/9.发明专利（10条）.xlsx`;
  // 专利列固定：发明人1~4 + 人员编号 4 列（同名「人员编号」被 SheetJS 覆盖，
  // 必须按位置读——loadMatrix 已展开合并单元格并按列序号返回）
  // 这里用 loadSheet 读后，需要手工按列号映射；改用 loadMatrix 按位置读
  const matrix = loadMatrix(filePath);
  if (matrix.length < 2) throw new Error(`${filePath} 行数不足`);

  // 表头：[0]=序号 [1]=原始申请人 [2]=申请日 ... [6]=发明人1 [7]=人员编号 ...
  // 源表没有专利名称列，因此完整保留申请/授权/类型/状态等真实字段供员工核对。
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const r = matrix[i];
    if (!r[0]) continue;
    rows.push({
      序号: r[0],
      '原始申请(专利权)人': r[1],
      申请日: r[2],
      授权日: r[3],
      '法律状态/事件': r[4],
      专利类型: r[5],
      '发明人1': r[6], '工号1': r[7],
      '发明人2': r[8], '工号2': r[9],
      '发明人3': r[10], '工号3': r[11],
      '发明人4': r[12], '工号4': r[13],
      '当前第一申请(专利权)人': r[14],
      简单法律状态: r[15],
      授权年: r[16],
      '公开(公告)日': r[17],
      申请年: r[18],
      '当前第一申请(专利权)人地址': r[19],
      代理机构: r[20],
      __sourceRowNo: String(i + 1),
    });
  }
  const mapping = {
    patentName: '原始申请(专利权)人',
    inventorCols: ['发明人1', '工号1', '发明人2', '工号2', '发明人3', '工号3', '发明人4', '工号4'],
  };
  const result = await importPatentFacts(prisma, 2026, filePath, rows, mapping, {
    replaceAcrossSourceFiles: true,
    preserveEmployeeScoreTotals: true,
  });
  console.log(JSON.stringify(result));
}

async function reimportTechRegulation() {
  console.log('--- 重导入技术贡献·运规（B1 修复，依赖 parse 合并单元格展开）---');
  const filePath = `${DATA_DIR}/6.《运规》编写 会审人员（135人）.xlsx`;
  // 真实表头在 row 3（前 2 行是标题/空），loadSheet 默认 row 1 为表头
  // 这里手动按列名读：[姓名=col2, 人员编号=col3, 地域=col4, 运规主要工作=col5, 规程名称=col6]
  // 但 loadSheet 用 row 1 表头会出错，需要直接按位置读
  const matrix = loadMatrix(filePath, 'Sheet1');
  const rows: Record<string, string>[] = [];
  for (let i = 3; i < matrix.length; i += 1) {
    const r = matrix[i];
    if (!r[0]) continue;
    rows.push({
      序号: r[0],
      employeeNo: r[2],
      employeeName: r[1],
      地域: r[3],
      projectName: r[5],     // 规程名称
      role: r[4],            // 《运规》主要工作
      __sourceRowNo: String(i + 1),
    });
  }
  const result = await importTechContribFacts(
    prisma, 'regulation', 2026, filePath, rows,
    { employeeNo: 'employeeNo', employeeName: 'employeeName', projectName: 'projectName', role: 'role' },
    { replaceAcrossSourceFiles: true, preserveEmployeeScoreTotals: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportTechTextbook() {
  console.log('--- 重导入技术贡献·教材/题库/课件（完整人员源行）---');
  const filePath = `${DATA_DIR}/4.参加公司级及以上教材编制、题库开发、课件开发人员名单（5人）.xlsx`;
  const rows = rowsFromMatrix(filePath, 2).map((row) => ({
    ...row,
    事实项目: '公司级及以上教材编制、题库开发、课件开发',
    参与角色: '参与人员',
  }));
  const result = await importTechContribFacts(
    prisma,
    'textbook',
    2026,
    filePath,
    rows,
    {
      employeeNo: '人员编号',
      employeeName: '姓名',
      projectName: '事实项目',
      role: '参与角色',
    },
    { replaceAcrossSourceFiles: true, preserveEmployeeScoreTotals: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportTicketRevision() {
  console.log('--- 重导入技术贡献·两票修订/审查（完整人员源行）---');
  const filePath = `${DATA_DIR}/5.《两票》参与修订人员、审查人员（19人）.xlsx`;
  const rows = rowsFromMatrix(filePath, 2).map((row) => ({
    ...row,
    事实项目: '《两票》修订/审查',
  }));
  const result = await importTechContribFacts(
    prisma,
    'ticket-revision',
    2026,
    filePath,
    rows,
    {
      employeeNo: '人员编号',
      employeeName: '姓名',
      projectName: '事实项目',
      role: '《两票》职务',
    },
    { replaceAcrossSourceFiles: true, preserveEmployeeScoreTotals: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportTickets() {
  console.log('--- 重导入两票（B2 修复：四份原始表，操作票按项不按步）---');
  const operationFile = `${DATA_DIR}/10.2025操作票（1013条）.xlsx`;
  const workFile = `${DATA_DIR}/11.2025工作票（853条）.xlsx`;
  const memberType2File = `${DATA_DIR}/12.工作班成员工作票二种表（1965人）.xlsx`;
  const memberType1File = `${DATA_DIR}/13.工作班成员工作票一种表（720人）.xlsx`;
  const operationRows = loadSheet(operationFile).rows;
  const workRows = loadSheet(workFile).rows;
  const toMemberRows = (rows: Record<string, string>[]): WorkMemberRow[] => rows.map((row) => ({
    ...row,
    票类型: row['票类型'],
    姓名: row['姓名'],
    人员编号: row['人员编号'],
  }));
  const memberType2Rows = toMemberRows(
    loadSheet(memberType2File).rows,
  );
  const memberType1Rows = toMemberRows(
    loadSheet(memberType1File).rows,
  );
  const memberRows = [...memberType2Rows, ...memberType1Rows];
  const users = await prisma.user.findMany({
    where: { employeeNo: { not: null } },
    select: { id: true, employeeNo: true, fullName: true },
  });
  const rosterUsers = users.map((user) => ({
    employeeNo: user.employeeNo!,
    fullName: user.fullName,
  }));
  const userIdByNo = new Map(users.map((user) => [user.employeeNo!, user.id]));
  const userByNo = new Map(users.map((user) => [user.employeeNo!, user]));
  const outsideRoster = new Map<string, string>();
  const collectOutsideRoster = (
    rows: Record<string, string>[],
    columns: Array<{ name: string; employeeNo: string }>,
  ) => {
    for (const row of rows) {
      for (const column of columns) {
        const employeeNo = String(row[column.employeeNo] ?? '').trim();
        const employeeName = String(row[column.name] ?? '').trim();
        if (employeeNo && !userByNo.has(employeeNo)) outsideRoster.set(employeeNo, employeeName);
      }
    }
  };
  collectOutsideRoster(operationRows, [
    { name: '操作人', employeeNo: '人员编号' },
    { name: '监护人', employeeNo: '人员编号_1' },
    { name: '值班负责人', employeeNo: '人员编号_2' },
    { name: '现场配合人员', employeeNo: '人员编号_3' },
  ]);
  collectOutsideRoster(workRows, [
    { name: '工作负责人', employeeNo: '人员编号' },
    { name: '开工许可人', employeeNo: '人员编号_1' },
    { name: '完工许可人', employeeNo: '人员编号_2' },
  ]);
  const malformedMemberRows = memberRows.filter((row) => !String(row.人员编号 ?? '').trim() || !String(row.姓名 ?? '').trim());
  if (malformedMemberRows.length > 0) {
    throw new Error(`工作班成员表含 ${malformedMemberRows.length} 条缺少姓名或人员编号的记录，拒绝写入`);
  }
  for (const row of memberRows) {
    const employeeNo = String(row.人员编号 ?? '').trim();
    if (!userByNo.has(employeeNo)) outsideRoster.set(employeeNo, String(row.姓名 ?? '').trim());
  }
  const rosterResolver = createRosterResolverFromUsers(rosterUsers);
  const ticketResult = aggregateTicketExecutionRows(
    operationRows,
    workRows,
    {
      resolve(name, employeeNo) {
        const user = employeeNo ? userByNo.get(employeeNo) : undefined;
        return user?.employeeNo
          ? { employeeNo: user.employeeNo, employeeName: user.fullName }
          : rosterResolver.resolve(name);
      },
    },
  );
  const sourceEmployeeNoCorrections = [...outsideRoster.entries()]
    .map(([sourceEmployeeNo, employeeName]) => ({ sourceEmployeeNo, employeeName, resolved: rosterResolver.resolve(employeeName) }))
    .filter((row) => row.resolved)
    .map(({ sourceEmployeeNo, employeeName, resolved }) => ({
      sourceEmployeeNo,
      employeeName,
      resolvedEmployeeNo: resolved!.employeeNo,
    }));
  const excludedOutsideRoster = [...outsideRoster.entries()]
    .filter(([, employeeName]) => !rosterResolver.resolve(employeeName))
    .map(([employeeNo, employeeName]) => ({ employeeNo, employeeName }));
  const excludedOutsideRosterNames = new Set(excludedOutsideRoster.map((row) => row.employeeName));
  const unresolvedNames = ticketResult.unmatchedNames.filter((name) => !excludedOutsideRosterNames.has(name));
  if (unresolvedNames.length > 0) {
    throw new Error(`两票原始表含 ${unresolvedNames.length} 个无法映射且非名册外参与人的姓名，拒绝写入：${unresolvedNames.slice(0, 10).join(', ')}`);
  }
  const allAggregates = mergeWorkMemberTicketScores(ticketResult.aggregates, memberRows);
  const aggregates = allAggregates.filter((aggregate) => userIdByNo.has(aggregate.employeeNo));
  const missingRoster = allAggregates
    .filter((aggregate) => !userIdByNo.has(aggregate.employeeNo));
  if (missingRoster.length > 0) {
    throw new Error(`两票原始表含 ${missingRoster.length} 名不在员工名册中的人员，拒绝写入：${missingRoster.slice(0, 10).map((x) => x.employeeNo).join(', ')}`);
  }
  const operationRecords = ticketResult.records.filter(
    (record) => record.recordType === 'OPERATION_TICKET',
  );
  const workRecords = ticketResult.records.filter(
    (record) => record.recordType === 'WORK_TICKET',
  );
  const memberType2Records = buildWorkMemberTicketRecords(
    memberType2Rows,
    undefined,
    '工作班成员二种票',
  );
  const memberType1Records = buildWorkMemberTicketRecords(
    memberType1Rows,
    undefined,
    '工作班成员一种票',
  );
  const allRecords = [
    ...operationRecords.map((record) => ({ ...record, sourceFile: operationFile })),
    ...workRecords.map((record) => ({ ...record, sourceFile: workFile })),
    ...memberType2Records.map((record) => ({ ...record, sourceFile: memberType2File })),
    ...memberType1Records.map((record) => ({ ...record, sourceFile: memberType1File })),
  ];
  const records = allRecords.filter((record) => userIdByNo.has(record.employeeNo));
  const recordTotalByNo = new Map<string, number>();
  for (const record of records) {
    recordTotalByNo.set(
      record.employeeNo,
      Math.round(((recordTotalByNo.get(record.employeeNo) ?? 0) + record.score) * 100) / 100,
    );
  }
  const scoreMismatches = aggregates.filter(
    (aggregate) => Math.abs((recordTotalByNo.get(aggregate.employeeNo) ?? 0) - aggregate.rawScore) > 0.001,
  );
  if (scoreMismatches.length > 0) {
    throw new Error(`两票逐票事实与原汇总分不一致，拒绝写入：${scoreMismatches.slice(0, 10).map((row) => row.employeeNo).join(', ')}`);
  }
  const existingTicketFacts = await prisma.performanceFact.findMany({
    where: { year: 2026, dimensionCode: 'worksite.ticket-execution' },
    select: { employeeNo: true, score: true },
  });
  const scoreReconciliation = compareEmployeeScoreTotals(existingTicketFacts, records);
  const coverageIssue = users.length === 435
    ? undefined
    : `应核对 435 人，当前名册 ${users.length} 人`;
  if (scoreReconciliation.length > 0 || coverageIssue) {
    const review = await prisma.factImportLog.create({
      data: {
        year: 2026,
        kind: 'detail-reconciliation',
        sourceFiles: [operationFile, workFile, memberType2File, memberType1File],
        summary: {
          status: 'PENDING_MANUAL_REVIEW',
          dimensionCode: 'worksite.ticket-execution',
          rosterCount: users.length,
          expectedRosterCount: 435,
          rosterCoveragePassed: !coverageIssue,
          checkedEmployees: users.length,
          existingFactCount: existingTicketFacts.length,
          proposedFactCount: records.length,
          mismatchCount: scoreReconciliation.length,
          formulaChanged: false,
          checkBasis: '现有员工两票原始总分 vs 四份源表逐票明细合计',
          processInvariant: '原始总分一致时，专业最高分和归一化结果保持不变',
        },
        unmatched: {
          scoreMismatches: scoreReconciliation.map((mismatch) => ({ ...mismatch })),
          ...(coverageIssue ? { coverageIssue } : {}),
        },
      },
      select: { id: true },
    });
    throw new EmployeeScoreTotalsMismatchError(
      'worksite.ticket-execution',
      review.id,
      scoreReconciliation,
      coverageIssue,
    );
  }
  const userIds = await loadUserIdByEmployeeNo(
    prisma,
    records.map((record) => record.employeeNo),
  );
  const persisted = await persistTicketRecords(
    prisma,
    2026,
    operationFile,
    records,
    userIds,
    { replaceAcrossSourceFiles: true },
  );
  await prisma.factImportLog.create({
    data: {
      year: 2026,
      kind: 'detail-reconciliation',
      sourceFiles: [operationFile, workFile, memberType2File, memberType1File],
      summary: {
        status: 'PASSED',
        dimensionCode: 'worksite.ticket-execution',
        rosterCount: users.length,
        checkedEmployees: users.length,
        existingFactCount: existingTicketFacts.length,
        proposedFactCount: records.length,
        mismatchCount: 0,
        formulaChanged: false,
        checkBasis: '现有员工两票原始总分 vs 四份源表逐票明细合计',
        processInvariant: '原始总分一致，专业最高分和归一化结果保持不变',
      },
      unmatched: {},
    },
  });
  console.log(JSON.stringify({
    source: { operationRows: operationRows.length, workRows: workRows.length, memberRows: memberRows.length },
    aggregates: aggregates.length,
    records: records.length,
    sourceEmployeeNoCorrections,
    excludedOutsideRoster,
    persisted,
  }, null, 2));
}

async function main() {
  const dimension = argValue('--dimension');
  const all = process.argv.includes('--all');
  let pendingManualReview = false;
  const run = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (error) {
      if (error instanceof EmployeeScoreTotalsMismatchError) {
        pendingManualReview = true;
        console.error(error.message);
        return;
      }
      throw error;
    }
  };

  if (all || dimension === 'safety') await run(reimportSafetyContribution);
  if (all || dimension === 'competition') await run(reimportCompetition);
  if (all || dimension === 'patent') await run(reimportPatents);
  if (all || dimension === 'innovation') await run(reimportInnovation);
  if (all || dimension === 'defects') await run(reimportDefects);
  if (all || dimension === 'tech-textbook') await run(reimportTechTextbook);
  if (all || dimension === 'tech-ticket-revision') await run(reimportTicketRevision);
  if (all || dimension === 'tech-regulation') await run(reimportTechRegulation);
  if (all || dimension === 'tickets') await run(reimportTickets);
  if (all || dimension === 'violation') await run(reimportViolation);
  if (pendingManualReview) process.exitCode = 2;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
