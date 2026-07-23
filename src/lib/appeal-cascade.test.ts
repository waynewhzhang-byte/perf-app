import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupAppealCascadeItems } from './appeal-cascade';

describe('groupAppealCascadeItems', () => {
  it('按一级章节分组', () => {
    const groups = groupAppealCascadeItems([
      { itemId: 'a', itemTitle: '技能等级', sectionTitle: '基本素质', totalScore: 3 },
      { itemId: 'b', itemTitle: '职称等级', sectionTitle: '基本素质', totalScore: 0 },
      { itemId: 'c', itemTitle: '两票执行', sectionTitle: '工作现场', totalScore: 5 },
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.sectionTitle === '基本素质')?.items.length, 2);
    assert.equal(groups.find((g) => g.sectionTitle === '工作现场')?.items[0].itemId, 'c');
  });
});
