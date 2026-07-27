import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFinalPerformanceReportWorkbook,
  loadFinalPerformanceReport,
  type FinalPerformanceReportResult,
} from './final-performance-report';
import type { FinalFactSnapshot } from './final-fact-snapshot';

const snapshot: FinalFactSnapshot = {
  version: 1,
  captureMode: 'FINAL_REVIEW',
  capturedAt: '2026-07-31T00:00:00.000Z',
  employee: {
    employeeNo: 'E001',
    employeeName: '张三',
    workAreaId: 'b1',
    workAreaName: '晋北运维分部',
    departmentId: 'd1',
    departmentName: '运维一班',
    declarationLevelId: 'l1',
    declarationLevelName: '一级',
    declarationSpecialtyId: 's1',
    declarationSpecialtyName: '变电运维',
  },
  profileFacts: [{
    id: 'profile-hire-date',
    dimensionCode: 'profile.hire-date',
    dimensionTitle: '参加工作时间',
    value: '2016-07-01',
    score: 0,
    sourceFile: '1.能级评价员工花名册.xlsx',
  }],
  basicFacts: [{
    id: 'basic-1',
    dimension: 'SKILL_LEVEL',
    tierValue: '技师',
    yearBreakdown: null,
    score: 3,
    sourceFile: '基本素质.xlsx',
  }],
  performanceFacts: [{
    id: 'fact-1',
    dimensionCode: 'worksite.defect-governance',
    dimensionTitle: '缺陷治理',
    score: 2,
    role: 'FIRST_DISCOVERER',
    eventType: 'DISCOVERY',
    defectRef: 'DEF-001',
    defectLevel: '一般',
    eventDate: '2026-01-02',
    sourceFile: '缺陷.xlsx',
    metadata: {},
    record: {
      id: 'fact-1',
      recordKey: 'defect:001',
      recordType: 'DEFECT',
      title: '甲站机构卡涩',
      roleLabel: '第一发现人',
      score: 2,
      occurredAt: '2026-01-02',
      details: [{ label: '变电站', value: '甲站' }],
      source: { file: '缺陷.xlsx', sheet: '明细', rowNo: 3 },
    },
  }],
  submissionFacts: [],
  scoreSheet: {
    year: 2026,
    employeeNo: 'E001',
    employeeName: '张三',
    declarationTier: '一级',
    positiveMaxScore: 20,
    positiveScore: 2,
    deductionScore: 0,
    totalScore: 2,
    sections: [{
      code: 'worksite',
      title: '工作现场',
      maxScore: 20,
      score: 2,
      items: [{
        dimensionCode: 'worksite.defect-governance',
        title: '缺陷治理',
        sectionCode: 'worksite',
        sectionTitle: '工作现场',
        maxScore: 20,
        score: 2,
        source: 'FACT',
        dataSource: 'fact',
        ruleType: 'SUM_CAP',
        ruleSummary: '事实累加，最高20分',
        hasImportedFacts: true,
        lines: [{ id: 'fact-1', label: '甲站机构卡涩', score: 2 }],
      }],
    }],
  },
  reconciliation: {
    archivedTotalScore: 2,
    recalculatedTotalScore: 2,
    difference: 0,
    status: 'MATCHED',
  },
};

describe('final performance XLSX', () => {
  it('keeps an approved employee without PerformanceRecord in manual-review output', async () => {
    const prisma = {
      formTemplate: {
        findUnique: async () => ({ id: 'tpl-1', title: '2026绩效表', year: 2026 }),
      },
      submission: {
        findMany: async (args: unknown) => {
          assert.deepEqual(
            (args as { where: unknown }).where,
            {
              templateId: 'tpl-1',
              status: 'L2_APPROVED',
              AND: [{
                OR: [
                  { branchId: { in: ['b1', 'b2'] } },
                  {
                    branchId: null,
                    user: { branchId: { in: ['b1', 'b2'] } },
                  },
                ],
              }],
            },
          );
          return [{
            id: 'sub-missing-record',
            workAreaName: '晋北运维分部',
            declarationLevelName: '一级',
            declarationSpecialtyName: '变电运维',
            l2ReviewedAt: new Date('2026-07-31T00:00:00.000Z'),
            totalScore: 12,
            user: {
              employeeNo: 'E099',
              fullName: '待复核员工',
              branch: { name: '晋北运维分部' },
              department: { name: '运维一班' },
            },
          }];
        },
      },
      performanceRecord: { findMany: async () => [] },
    } as any;
    const report = await loadFinalPerformanceReport(prisma, {
      templateId: 'tpl-1',
      branchIds: ['b1', 'b2'],
      declarationLevelIds: [],
      declarationSpecialtyIds: [],
    });
    assert.equal(report?.rows.length, 1);
    assert.equal(report?.rows[0]?.factSnapshot, null);
    const result = buildFinalPerformanceReportWorkbook(report!);
    assert.equal(result.manualReviewCount, 1);
  });

  it('contains summary, raw facts, calculation and review sheets', () => {
    const report: FinalPerformanceReportResult = {
      template: { id: 'tpl-1', title: '2026绩效表', year: 2026 },
      rows: [{
        submissionId: 'sub-1',
        employeeNo: 'E001',
        employeeName: '张三',
        workAreaName: '晋北运维分部',
        departmentName: '运维一班',
        declarationLevelName: '一级',
        declarationSpecialtyName: '变电运维',
        finalScore: 2,
        finalizedAt: '2026-07-31T00:00:00.000Z',
        factSnapshot: snapshot,
      }],
    };
    const { workbook, manualReviewCount } =
      buildFinalPerformanceReportWorkbook(report);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      '员工绩效汇总',
      '绩效事实明细',
      '评分计算过程',
      '人工复核',
      '导出说明',
    ]);
    assert.equal(manualReviewCount, 0);
    assert.equal(
      workbook.getWorksheet('绩效事实明细')?.getCell('H2').value,
      '2016-07-01',
    );
    assert.equal(
      workbook.getWorksheet('绩效事实明细')?.getCell('G3').value,
      '技能等级',
    );
    assert.equal(
      workbook.getWorksheet('绩效事实明细')?.getCell('H4').value,
      '甲站机构卡涩',
    );
    assert.equal(
      workbook.getWorksheet('评分计算过程')?.getCell('I2').value,
      2,
    );
  });

  it('routes legacy records without snapshots to manual review', () => {
    const report: FinalPerformanceReportResult = {
      template: { id: 'tpl-1', title: '2026绩效表', year: 2026 },
      rows: [{
        submissionId: 'sub-legacy',
        employeeNo: 'E002',
        employeeName: '李四',
        workAreaName: '晋中运维分部',
        departmentName: '',
        declarationLevelName: '二级',
        declarationSpecialtyName: '变电运维',
        finalScore: 10,
        finalizedAt: '2026-07-31T00:00:00.000Z',
        factSnapshot: null,
      }],
    };
    const { workbook, manualReviewCount } =
      buildFinalPerformanceReportWorkbook(report);
    assert.equal(manualReviewCount, 1);
    assert.equal(
      workbook.getWorksheet('人工复核')?.getCell('C2').value,
      '终审归档缺少事实快照',
    );
  });
});
