import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreSkillLevel,
  scoreTitleLevel,
  scorePerformanceLevel,
} from './basic-quality';

describe('scoreSkillLevel', () => {
  it('高级技师 → 4', () => assert.equal(scoreSkillLevel('高级技师'), 4));
  it('技师 → 3', () => assert.equal(scoreSkillLevel('技师'), 3));
  it('高级工 → 2', () => assert.equal(scoreSkillLevel('高级工'), 2));
  it('中级工 → 1（归「其他」）', () => assert.equal(scoreSkillLevel('中级工'), 1));
  it('空 → 1（归「其他」）', () => assert.equal(scoreSkillLevel(null), 1));
  it('空字符串 → 1', () => assert.equal(scoreSkillLevel(''), 1));
  it('未知值 → 1', () => assert.equal(scoreSkillLevel('未知'), 1));
  it('带空格 → 4', () => assert.equal(scoreSkillLevel('  高级技师  '), 4));
});

describe('scoreTitleLevel', () => {
  it('正高级 → 4', () => assert.equal(scoreTitleLevel('正高级'), 4));
  it('副高级 → 4', () => assert.equal(scoreTitleLevel('副高级'), 4));
  it('中级 → 3', () => assert.equal(scoreTitleLevel('中级'), 3));
  it('初级 → 2', () => assert.equal(scoreTitleLevel('初级'), 2));
  it('空 → 0', () => assert.equal(scoreTitleLevel(null), 0));
  it('未知值 → 0', () => assert.equal(scoreTitleLevel('其他'), 0));
});

describe('scorePerformanceLevel', () => {
  it('3A → 6', () => {
    assert.deepEqual(scorePerformanceLevel(['A', 'A', 'A']), { code: '3A', score: 6, complete: true });
  });
  it('2A1B → 5.5', () => {
    assert.deepEqual(scorePerformanceLevel(['A', 'B', 'A']), { code: '2A1B', score: 5.5, complete: true });
  });
  it('1A2B → 5', () => {
    assert.deepEqual(scorePerformanceLevel(['B', 'A', 'B']), { code: '1A2B', score: 5, complete: true });
  });
  it('3B → 4.5', () => {
    assert.deepEqual(scorePerformanceLevel(['B', 'B', 'B']), { code: '3B', score: 4.5, complete: true });
  });
  it('含 C（A/A/C）→ 其他 4', () => {
    const r = scorePerformanceLevel(['A', 'A', 'C']);
    assert.equal(r.code, '其他');
    assert.equal(r.score, 4);
    assert.equal(r.complete, true);
  });
  it('缺失一年（A/B/null）→ 其他 4，不完整', () => {
    const r = scorePerformanceLevel(['A', 'B', null]);
    assert.equal(r.code, '其他');
    assert.equal(r.score, 4);
    assert.equal(r.complete, false);
  });
  it('全缺失 → 其他 4，不完整', () => {
    const r = scorePerformanceLevel([null, null, null]);
    assert.equal(r.code, '其他');
    assert.equal(r.score, 4);
    assert.equal(r.complete, false);
  });
  it('空数组 → 其他 4', () => {
    const r = scorePerformanceLevel([]);
    assert.equal(r.code, '其他');
    assert.equal(r.score, 4);
  });
  it('小写 a/b 容错 → 2A1B', () => {
    const r = scorePerformanceLevel(['a', 'b', 'a']);
    assert.equal(r.code, '2A1B');
    assert.equal(r.score, 5.5);
  });
  it('非 A/B/C 字母（A/B/D）→ 其他 4，不完整', () => {
    const r = scorePerformanceLevel(['A', 'B', 'D']);
    assert.equal(r.code, '其他');
    assert.equal(r.score, 4);
    assert.equal(r.complete, false);
  });
});

// ── 从 DB tiers 查分（参数化，非硬编码）──────────────────────────
describe('scoreSkillLevel (tiers 参数化)', () => {
  it('传入自定义 tiers 改变分数', () => {
    assert.equal(scoreSkillLevel('高级技师', { 高级技师: 9 }), 9);
  });
  it('未传 tiers 时回退默认（向后兼容）', () => {
    assert.equal(scoreSkillLevel('高级技师'), 4);
    assert.equal(scoreSkillLevel('未知'), 1);
  });
});

describe('scoreTitleLevel (tiers 参数化)', () => {
  it('传入自定义 tiers 改变分数', () => {
    assert.equal(scoreTitleLevel('副高级', { 副高级: 7 }, 0), 7);
  });
  it('未传 tiers 时回退默认', () => {
    assert.equal(scoreTitleLevel('副高级'), 4);
    assert.equal(scoreTitleLevel(null), 0);
  });
});

describe('scorePerformanceLevel (tiers 参数化)', () => {
  it('传入自定义 comboTiers 改变分数', () => {
    const r = scorePerformanceLevel(['A', 'A', 'A'], { '3A': 10 });
    assert.equal(r.score, 10);
    assert.equal(r.code, '3A');
  });
  it('未传 comboTiers 时回退默认 3A=6', () => {
    assert.equal(scorePerformanceLevel(['A', 'A', 'A']).score, 6);
  });
});
