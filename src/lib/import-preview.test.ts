import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { previewBasicFacts } from './import-preview';

describe('previewBasicFacts', () => {
  it('返回每行三维度试算分', () => {
    const rows = previewBasicFacts(
      { employeeNo: '工号', fullName: '姓名', skill: '技能等级', title: '职称等级', perf2023: '2023', perf2024: '2024', perf2025: '2025' },
      [{ '工号': '001', '姓名': '张', '技能等级': '技师', '职称等级': '中级', '2023': 'A', '2024': 'A', '2025': 'A' }],
      { skill: { 技师: 3 }, title: { 中级: 3 }, performance: { '3A': 6 } },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employeeNo, '001');
    assert.equal(rows[0].skillScore, 3);
    assert.equal(rows[0].titleScore, 3);
    assert.equal(rows[0].performanceScore, 6);
  });
});
