import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeImportedScoresByOrg,
  type ImportedScoreRow,
} from './imported-score-batch';

const sample = (overrides: Partial<ImportedScoreRow>): ImportedScoreRow => ({
  employeeNo: '001',
  employeeName: '甲',
  gender: '男',
  branchName: '晋北运维分部',
  departmentName: '运维检修部',
  declarationTier: '一级',
  basicScore: 10,
  basicMaxScore: 14,
  worksiteScore: 5,
  worksiteMaxScore: 42,
  ticketScore: 3,
  ticketMaxScore: 30,
  defectScore: 2,
  defectMaxScore: 12,
  skillScore: 3,
  titleScore: 3,
  performanceLevelScore: 4,
  importedTotalScore: 15,
  importedMaxScore: 56,
  ticketRawScore: 10,
  defectRawScore: 2,
  ...overrides,
});

describe('summarizeImportedScoresByOrg', () => {
  it('按工区与部门汇总均值', () => {
    const rows = [
      sample({ employeeNo: '001', importedTotalScore: 20, basicScore: 12, worksiteScore: 8, ticketScore: 5 }),
      sample({ employeeNo: '002', employeeName: '乙', importedTotalScore: 10, basicScore: 8, worksiteScore: 2, ticketScore: 0, defectScore: 0 }),
      sample({
        employeeNo: '003',
        employeeName: '丙',
        branchName: '晋中运维分部',
        importedTotalScore: 30,
        basicScore: 14,
        worksiteScore: 16,
      }),
    ];
    const { byBranch, byDepartment } = summarizeImportedScoresByOrg(rows);
    assert.equal(byBranch.length, 2);
    const north = byBranch.find((g) => g.branchName === '晋北运维分部')!;
    assert.equal(north.headcount, 2);
    assert.equal(north.avgImportedTotal, 15);
    assert.equal(byDepartment.length, 2);
  });
});
