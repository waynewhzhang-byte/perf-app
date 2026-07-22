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
import { buildInnovationSeeds } from '@/lib/innovation-import';
import { buildFactsFromDefectRows, type DefectRow } from '@/lib/defect-governance';
import { persistSeedsBySource } from '@/lib/fact-import-common';
import {
  aggregateTicketExecutionRows,
  mergeWorkMemberTicketScores,
  type WorkMemberRow,
} from '@/lib/ticket-execution-import';
import { createRosterResolverFromUsers } from '@/lib/roster-resolver';
import { loadUserIdByEmployeeNo, persistTicketAggregates } from '@/lib/fact-import-persistence';

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
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

async function reimportInnovation() {
  console.log('--- 重导入创新奖项（按源表项目列的获奖层级计分）---');
  const filePath = `${DATA_DIR}/8.创新奖项人员总汇（34人）.xlsx`;
  const seeds = buildInnovationSeeds(rowsFromMatrix(filePath, 1), {
    employeeNo: '人员编号', employeeName: '姓名', award: '奖项', level: '项目', project: '备注',
  }, 2026);
  const result = await persistSeedsBySource(prisma, {
    year: 2026, dimensionCode: 'performance.innovation.award', sourceFile: filePath, replaceAcrossSourceFiles: true,
  }, seeds);
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
  const imported = buildFactsFromDefectRows(rows as DefectRow[], 2025, resolverWithSourceNo);
  const result = await persistSeedsBySource(prisma, {
    year: 2026, dimensionCode: 'worksite.defect-governance', sourceFile: filePath, replaceAcrossSourceFiles: true,
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

  // 表头：[0]=序号 [1]=原始申请人 [6]=发明人1 [7]=人员编号 [8]=发明人2 [9]=人员编号 ...
  // 专利名取 col 1（原始申请(专利权)人）
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const r = matrix[i];
    if (!r[0]) continue;
    rows.push({
      patentName: r[1],
      '发明人1': r[6], '工号1': r[7],
      '发明人2': r[8], '工号2': r[9],
      '发明人3': r[10], '工号3': r[11],
      '发明人4': r[12], '工号4': r[13],
    });
  }
  const mapping = {
    patentName: 'patentName',
    inventorCols: ['发明人1', '工号1', '发明人2', '工号2', '发明人3', '工号3', '发明人4', '工号4'],
  };
  const result = await importPatentFacts(prisma, 2026, filePath, rows, mapping, { replaceAcrossSourceFiles: true });
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
      employeeNo: r[2],
      employeeName: r[1],
      projectName: r[5],     // 规程名称
      role: r[4],            // 《运规》主要工作
    });
  }
  const result = await importTechContribFacts(
    prisma, 'regulation', 2026, filePath, rows,
    { employeeNo: 'employeeNo', employeeName: 'employeeName', projectName: 'projectName', role: 'role' },
    { replaceAcrossSourceFiles: true },
  );
  console.log(JSON.stringify(result));
}

async function reimportTickets() {
  console.log('--- 重导入两票（B2 修复：四份原始表，操作票按项不按步）---');
  const operationRows = loadSheet(`${DATA_DIR}/10.2025操作票（1013条）.xlsx`).rows;
  const workRows = loadSheet(`${DATA_DIR}/11.2025工作票（853条）.xlsx`).rows;
  const memberRows: WorkMemberRow[] = [
    ...loadSheet(`${DATA_DIR}/12.工作班成员工作票二种表（1965人）.xlsx`).rows,
    ...loadSheet(`${DATA_DIR}/13.工作班成员工作票一种表（720人）.xlsx`).rows,
  ].map((row) => ({
    票类型: row['票类型'],
    姓名: row['姓名'],
    人员编号: row['人员编号'],
  }));
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
  const persisted = await persistTicketAggregates(
    prisma,
    2026,
    '10-13.两票数据汇总.xlsx',
    aggregates,
    await loadUserIdByEmployeeNo(prisma, aggregates.map((aggregate) => aggregate.employeeNo)),
  );
  console.log(JSON.stringify({
    source: { operationRows: operationRows.length, workRows: workRows.length, memberRows: memberRows.length },
    aggregates: aggregates.length,
    sourceEmployeeNoCorrections,
    excludedOutsideRoster,
    persisted,
  }, null, 2));
}

async function main() {
  const dimension = argValue('--dimension');
  const all = process.argv.includes('--all');

  if (all || dimension === 'patent') await reimportPatents();
  if (all || dimension === 'innovation') await reimportInnovation();
  if (all || dimension === 'defects') await reimportDefects();
  if (all || dimension === 'tech-regulation') await reimportTechRegulation();
  if (all || dimension === 'tickets') await reimportTickets();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
