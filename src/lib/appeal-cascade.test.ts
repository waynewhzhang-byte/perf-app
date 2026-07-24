import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEAL_SCORING_POINT_CODES,
  groupAppealCascadeItems,
  isAppealableDimensionCode,
} from './appeal-cascade';

describe('appeal-cascade scoring points', () => {
  it('评分项点固定为 11 个', () => {
    assert.equal(APPEAL_SCORING_POINT_CODES.length, 11);
  });

  it('仅允许 11 个评分项，参加工作时间不可申诉', () => {
    assert.equal(isAppealableDimensionCode('basic.skill-level'), true);
    assert.equal(isAppealableDimensionCode('profile.hire-date'), false);
    assert.equal(isAppealableDimensionCode('worksite.ticket-execution.leaf'), false);
    assert.equal(isAppealableDimensionCode(null), false);
  });

  it('按一级维度分组并过滤非评分项', () => {
    const groups = groupAppealCascadeItems([
      {
        itemId: 'a',
        itemTitle: '技能等级',
        sectionTitle: '基本素质',
        sectionCode: 'basic',
        dimensionCode: 'basic.skill-level',
        totalScore: 3,
      },
      {
        itemId: 'noise',
        itemTitle: '某次两票明细',
        sectionTitle: '工作现场',
        sectionCode: 'worksite',
        dimensionCode: 'worksite.ticket-raw-line',
        totalScore: 0.1,
      },
      {
        itemId: 'b',
        itemTitle: '职称等级',
        sectionTitle: '基本素质',
        sectionCode: 'basic',
        dimensionCode: 'basic.title-level',
        totalScore: 0,
      },
      {
        itemId: 'c',
        itemTitle: '两票执行',
        sectionTitle: '工作现场',
        sectionCode: 'worksite',
        dimensionCode: 'worksite.ticket-execution',
        totalScore: 5,
      },
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.sectionTitle === '基本素质')?.items.length, 2);
    assert.equal(groups.find((g) => g.sectionTitle === '工作现场')?.items[0].itemId, 'c');
    assert.ok(!groups.some((g) => g.items.some((i) => i.itemId === 'noise')));
  });

  it('章节顺序遵循评分标准 excelOrder', () => {
    const groups = groupAppealCascadeItems([
      {
        itemId: 'w',
        itemTitle: '两票执行',
        sectionTitle: '工作现场',
        sectionCode: 'worksite',
        dimensionCode: 'worksite.ticket-execution',
        totalScore: 1,
      },
      {
        itemId: 'b',
        itemTitle: '技能等级',
        sectionTitle: '基本素质',
        sectionCode: 'basic',
        dimensionCode: 'basic.skill-level',
        totalScore: 1,
      },
    ]);
    assert.deepEqual(groups.map((g) => g.sectionTitle), ['基本素质', '工作现场']);
  });
});
