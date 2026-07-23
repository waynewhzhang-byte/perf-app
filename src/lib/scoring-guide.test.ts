import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoringGuideContent } from './scoring-guide';
import { SCORING_STANDARDS } from './scoring-standards';

describe('buildScoringGuideContent', () => {
  const guide = buildScoringGuideContent(2026);

  it('正向满分 100，含 3 个一级维度', () => {
    assert.equal(guide.positiveMaxScore, 100);
    assert.equal(guide.sections.length, 3);
    assert.equal(guide.sections[0]?.title, '基本素质');
    assert.equal(guide.sections[0]?.maxScore, 14);
    assert.equal(guide.sections[1]?.maxScore, 44);
    assert.equal(guide.sections[2]?.maxScore, 42);
  });

  it('11 项绩效计分（9 正向 + 2 扣分）', () => {
    const positiveCount = SCORING_STANDARDS.filter((s) => s.dataSource !== 'deduction').length;
    const sectionItemCount = guide.sections.reduce((n, s) => n + s.items.length, 0);
    assert.equal(positiveCount, 9);
    assert.equal(sectionItemCount, 9);
    assert.equal(guide.deductionItems.length, 2);
    assert.equal(positiveCount + guide.deductionItems.length, 11);
  });

  it('包含能级对照与数据流说明', () => {
    assert.equal(guide.declarationLevels.length, 3);
    assert.ok(guide.dataFlowSteps.length >= 4);
    assert.match(guide.evaluationCutoffNote, /7 月 31 日/);
  });
});
