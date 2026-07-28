import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { PrismaClient } from '@prisma/client';
import {
  buildAnnualQuantitativeReportAnalysis,
  buildAnnualQuantitativeReportRows,
  buildAnnualQuantitativeReportWorkbook,
  loadAnnualQuantitativeReportRows,
  workYearsAsOf,
  type AnnualReportUserSource,
} from './annual-quantitative-report';

const options = { year: 2026, unit: '__ALL__' };
const users: AnnualReportUserSource[] = [
  {
    employeeNo: '1001',
    fullName: '三级员工',
    gender: '男',
    profile: { 参加工作时间: '2021-06-01', 岗位分类: '变电一次设备检修', 岗位: '班员' },
    branch: { id: 'b1', name: '变电检修中心' },
    position: { name: '班员' },
  },
  {
    employeeNo: '1002',
    fullName: '二级员工',
    gender: '女',
    profile: { 参加工作时间: '2021-05-31', 岗位分类: '变电二次设备检修', 岗位: '技术员' },
    branch: { id: 'b2', name: '二次检修中心' },
    position: { name: '技术员' },
  },
  {
    employeeNo: '1003',
    fullName: '一级员工',
    gender: '男',
    profile: { 参加工作时间: '2017-05-31', 岗位分类: '变电运维', 岗位: '班长' },
    branch: { id: 'b3', name: '晋北运维分部' },
    position: { name: '班长' },
  },
  {
    employeeNo: '1004',
    fullName: '三级基准员工',
    gender: '男',
    profile: { 参加工作时间: '2023-01-01', 岗位分类: '变电一次设备检修', 岗位: '班员' },
    branch: { id: 'b4', name: '其他中心' },
    position: { name: '班员' },
  },
];
const basicFacts = users.flatMap((user) => [
  { employeeNo: user.employeeNo!, dimension: 'SKILL_LEVEL', score: 3 },
  { employeeNo: user.employeeNo!, dimension: 'TITLE_LEVEL', score: 2 },
  { employeeNo: user.employeeNo!, dimension: 'PERFORMANCE_LEVEL', score: 5 },
]);
const performanceFacts = [
  { employeeNo: '1001', dimensionCode: 'worksite.ticket-execution', score: 0.06 },
  { employeeNo: '1004', dimensionCode: 'worksite.ticket-execution', score: 0.11 },
  { employeeNo: '1002', dimensionCode: 'worksite.ticket-execution', score: 10 },
  { employeeNo: '1003', dimensionCode: 'worksite.ticket-execution', score: 20 },
  { employeeNo: '1001', dimensionCode: 'worksite.defect-governance', score: 0.5 },
  { employeeNo: '1001', dimensionCode: 'worksite.defect-governance', score: 1 },
];

describe('workYearsAsOf', () => {
  const asOf = new Date('2026-05-31T00:00:00.000Z');

  it('uses completed years at the May cutoff', () => {
    assert.equal(workYearsAsOf('2021-06-01', asOf), 4);
    assert.equal(workYearsAsOf('2021-05-31', asOf), 5);
    assert.equal(workYearsAsOf('2017-05-31', asOf), 9);
    assert.equal(workYearsAsOf('', asOf), null);
  });
});

describe('annual quantitative report', () => {
  const rows = buildAnnualQuantitativeReportRows(users, basicFacts, performanceFacts, options);

  it('groups every row strictly by completed work years', () => {
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.employeeNo, row.tier])), {
      '1003': '一级',
      '1002': '二级',
      '1001': '二级',
      '1004': '三级',
    });
    assert.equal(rows.find((row) => row.employeeNo === '1001')?.ticketExecution, 16.4);
    assert.equal(rows.find((row) => row.employeeNo === '1004')?.ticketExecution, 30);
    assert.equal(rows.find((row) => row.employeeNo === '1001')?.factCount, 2);
  });

  it('builds dashboard totals from the same 14-dimension report rows', () => {
    const analysis = buildAnnualQuantitativeReportAnalysis(rows);
    const employee = analysis.records.find((row) => row.employeeNo === '1001');

    assert.equal(analysis.employeeCount, 4);
    assert.deepEqual(analysis.tierCounts, { 一级: 1, 二级: 2, 三级: 1 });
    assert.equal(analysis.branchBreakdown.length, 4);
    assert.equal(analysis.branchBreakdown[0]?.employeeCount, 1);
    assert.equal(employee?.basicScore, 10);
    assert.equal(employee?.worksiteScore, 17.9);
    assert.equal(employee?.totalScore, 27.9);
    assert.equal(analysis.dimensionAverages.find((dimension) => dimension.key === 'ticketExecution')?.average, 26.6);
  });

  it('uses each specialty maximum before filtering a department', async () => {
    const mockPrisma = {
      user: {
        findMany: async (args: unknown) => {
          assert.deepEqual(args, {
            where: { employeeNo: { not: null } },
            select: {
              employeeNo: true,
              fullName: true,
              gender: true,
              profile: true,
              branch: { select: { id: true, name: true } },
              position: { select: { name: true } },
            },
            orderBy: [{ employeeNo: 'asc' }],
          });
          return users;
        },
      },
      employeeBasicFact: { findMany: async () => basicFacts },
      performanceFact: { findMany: async () => performanceFacts },
      submissionItem: { findMany: async () => [] },
    } as unknown as PrismaClient;

    const departmentRows = await loadAnnualQuantitativeReportRows(mockPrisma, {
      year: 2026,
      unit: '变电检修中心',
      branchId: 'b1',
    });
    assert.equal(departmentRows.length, 1);
    assert.equal(departmentRows[0]?.employeeNo, '1001');
    assert.equal(departmentRows[0]?.ticketExecution, 16.4);
  });

  it('applies admin appeal overrides into dimension scores and notes', async () => {
    const { applyQuantitativeAppealOverrides } = await import('./annual-quantitative-report');
    const withOverride = applyQuantitativeAppealOverrides(rows, [{
      employeeNo: '1001',
      dimensionCode: 'basic.skill-level',
      systemScore: 3,
      overrideScore: 4,
    }]);
    const employee = withOverride.find((row) => row.employeeNo === '1001');
    assert.equal(employee?.skillLevel, 4);
    assert.equal(employee?.importedTotalScore, 27.9);
    assert.equal(employee?.appealAdjustmentDelta, 1);
    assert.match(employee?.appealAdjustmentNote ?? '', /技能等级：3→4/);

    const analysis = buildAnnualQuantitativeReportAnalysis(withOverride);
    assert.equal(analysis.records.find((row) => row.employeeNo === '1001')?.totalScore, 28.9);
  });

  it('builds the workbook with appeal columns and final total', async (t) => {
    const workbook = buildAnnualQuantitativeReportWorkbook(rows, options);
    const dir = mkdtempSync(join(tmpdir(), 'perf-annual-report-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'report.xlsx');
    await workbook.xlsx.writeFile(path);

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.readFile(path);
    assert.deepEqual(reopened.worksheets.slice(0, 3).map((sheet) => sheet.name), ['一级', '二级', '三级']);
    for (const sheet of reopened.worksheets.slice(0, 3)) {
      assert.match(String(sheet.getCell('A1').value), /2026年/);
      assert.equal(sheet.pageSetup.orientation, 'landscape');
      assert.equal(sheet.pageSetup.fitToWidth, 1);
      assert.equal(typeof sheet.getCell('A5').value, 'number');
      assert.equal(typeof sheet.getCell('B5').value, 'string');
      assert.equal(sheet.getCell('V2').value, '申诉调整');
      assert.equal(sheet.getCell('V3').value, '申诉调整说明');
      assert.equal(sheet.getCell('W3').value, '最终总分');
      assert.equal(sheet.getRow(5).cellCount, 23);
    }
    assert.match(String(reopened.getWorksheet('积分规则')?.getCell('B8').value), /本专业最高分计30分/);
    assert.equal(reopened.getWorksheet('积分规则')?.getCell('A10').value, '申诉覆盖');
    assert.match(String(reopened.getWorksheet('积分规则')?.getCell('B10').value), /覆盖后得分/);
  });
});
