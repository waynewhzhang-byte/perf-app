import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoringGuideContent } from './scoring-guide';
import { SCORING_STANDARDS } from './scoring-standards';
import type { ScoringStandardDisplayOverride } from './scoring-standards';

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

describe('buildScoringGuideContent 文案覆盖', () => {
  it('DB 覆盖优先于常量（仅替换非 null 字段，满分不变）', () => {
    const overrides = new Map<string, ScoringStandardDisplayOverride>([
      // 只改技能等级的说明文字，其余字段保持默认
      ['basic.skill-level', { scoringSummary: '管理员修订后的技能等级说明' }],
      // 标题与说明一起改
      ['basic.title-level', { title: '职称（修订）', scoringSummary: '修订说明' }],
    ]);
    const guide = buildScoringGuideContent(2026, overrides);

    const skill = [...guide.sections[0]!.items].find((i) => i.code === 'basic.skill-level')!;
    const title = [...guide.sections[0]!.items].find((i) => i.code === 'basic.title-level')!;

    assert.equal(skill.scoringSummary, '管理员修订后的技能等级说明');
    // 未覆盖的字段回退常量
    assert.equal(skill.title, SCORING_STANDARDS.find((s) => s.code === 'basic.skill-level')!.title);
    assert.equal(title.title, '职称（修订）');

    // 满分与正向合计不受文案影响
    assert.equal(guide.positiveMaxScore, 100);
    assert.equal(skill.maxScore, 4);
    assert.equal(title.maxScore, 4);
  });

  it('空覆盖 Map 等价于不传，显示常量默认值', () => {
    const guide = buildScoringGuideContent(2026, new Map());
    const skill = [...guide.sections[0]!.items].find((i) => i.code === 'basic.skill-level')!;
    assert.equal(skill.scoringSummary, SCORING_STANDARDS.find((s) => s.code === 'basic.skill-level')!.scoringSummary);
  });
});
