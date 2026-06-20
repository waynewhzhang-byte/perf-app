import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBasicFactDrafts, type BasicFactFieldMapping } from './basic-fact-import';

const mapping: BasicFactFieldMapping = {
  employeeNo: '工号', fullName: '姓名', skill: '技能等级', title: '职称等级',
  perf2023: '2023', perf2024: '2024', perf2025: '2025',
};

describe('buildBasicFactDrafts', () => {
  it('一行 → 三条事实（技能/职称/绩效），绩效按三年组合计分', () => {
    const drafts = buildBasicFactDrafts(
      mapping,
      [{ '工号': '001', '姓名': '张三', '技能等级': '技师', '职称等级': '中级', '2023': 'A', '2024': 'B', '2025': 'B' }],
      2025,
      { skill: { 技师: 3 }, title: { 中级: 3 }, performance: { '2A1B': 5.5, '1A2B': 5 } },
    );
    assert.equal(drafts.length, 3);
    const byDim = Object.fromEntries(drafts.map((d) => [d.dimension, d]));
    assert.equal(byDim.SKILL_LEVEL.score, 3);
    assert.equal(byDim.TITLE_LEVEL.score, 3);
    // [A,B,B] → 1A2B → 5
    assert.equal(byDim.PERFORMANCE_LEVEL.score, 5);
    assert.equal(byDim.PERFORMANCE_LEVEL.tierValue, '1A2B');
    assert.deepEqual(byDim.PERFORMANCE_LEVEL.yearBreakdown, { '2023': 'A', '2024': 'B', '2025': 'B' });
  });

  it('3A → 6 分', () => {
    const drafts = buildBasicFactDrafts(
      mapping,
      [{ '工号': '002', '姓名': '李', '技能等级': '', '职称等级': '', '2023': 'A', '2024': 'A', '2025': 'A' }],
      2025,
      { skill: {}, title: {}, performance: { '3A': 6 } },
    );
    const perf = drafts.find((d) => d.dimension === 'PERFORMANCE_LEVEL')!;
    assert.equal(perf.score, 6);
    assert.equal(perf.tierValue, '3A');
  });

  it('工号缺失的行跳过', () => {
    const drafts = buildBasicFactDrafts(
      mapping,
      [{ '工号': '', '姓名': 'X', '技能等级': '', '职称等级': '', '2023': '', '2024': '', '2025': '' }],
      2025,
    );
    assert.equal(drafts.length, 0);
  });
});
