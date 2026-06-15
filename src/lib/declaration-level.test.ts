import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeLevel, levelFromHireDate } from './declaration-level';

describe('computeLevel', () => {
  it('0 年 → 一级', () => assert.equal(computeLevel(0), '一级'));
  it('2 年 → 一级', () => assert.equal(computeLevel(2), '一级'));
  it('4 年 → 一级', () => assert.equal(computeLevel(4), '一级'));
  it('5 年 → 二级', () => assert.equal(computeLevel(5), '二级'));
  it('7 年 → 二级', () => assert.equal(computeLevel(7), '二级'));
  it('8 年 → 三级', () => assert.equal(computeLevel(8), '三级'));
  it('15 年 → 三级', () => assert.equal(computeLevel(15), '三级'));
});

describe('levelFromHireDate', () => {
  it('2024年入职 → 2026年年中 为 2 年 → 一级', () => {
    const d = new Date('2024-06-01');
    const asOf = new Date('2026-06-13');
    assert.equal(levelFromHireDate(d, asOf), '一级');
  });

  it('2021年6月入职 → 2026年6月 为 5 年 → 二级', () => {
    const d = new Date('2021-06-01');
    const asOf = new Date('2026-06-13');
    assert.equal(levelFromHireDate(d, asOf), '二级');
  });

  it('2018年以前入职 → 三级', () => {
    const d = new Date('2017-12-31');
    const asOf = new Date('2026-06-13');
    assert.equal(levelFromHireDate(d, asOf), '三级');
  });

  it('边界：入职周年当天不含', () => {
    // 2021-06-13 入职，2026-06-13 刚好 5 年 → 二级
    const d = new Date('2021-06-13');
    const asOf = new Date('2026-06-13');
    assert.equal(levelFromHireDate(d, asOf), '二级');
  });
});
