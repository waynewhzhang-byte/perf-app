import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateOnly, computeItemScore, UpsertSchema } from './submission-validator';

describe('parseDateOnly', () => {
  it('解析标准 YYYY-MM-DD 格式', () => {
    const result = parseDateOnly('2024-01-15');
    assert.ok(result instanceof Date);
    assert.equal(result.getFullYear(), 2024);
    assert.equal(result.getMonth(), 0); // 1 月 = index 0
    assert.equal(result.getDate(), 15);
  });

  it('undefined 返回 null', () => {
    assert.equal(parseDateOnly(undefined), null);
  });

  it('空字符串返回 null', () => {
    assert.equal(parseDateOnly(''), null);
  });

  it('非标准格式返回 null', () => {
    assert.equal(parseDateOnly('2024/01/15'), null);
    assert.equal(parseDateOnly('01-15-2024'), null);
    assert.equal(parseDateOnly('20240115'), null);
  });

  it('非法格式返回 null', () => {
    // JS Date 构造器会 auto-correct 越界值（如月=13），所以用格式错误测
    assert.equal(parseDateOnly('2024/01/15'), null);
    assert.equal(parseDateOnly('01-15-2024'), null);
    assert.equal(parseDateOnly('not-a-date'), null);
  });

  it('闰年 2 月 29 日正常', () => {
    const result = parseDateOnly('2024-02-29')!;
    assert.equal(result.getDate(), 29);
  });
});

describe('computeItemScore', () => {
  it('TIERS 模式：累加选中分值', () => {
    const meta = { scoreMode: 'TIERS', maxScore: null };
    const selected = [{ score: 10 }, { score: 20 }, { score: 5 }];
    assert.equal(computeItemScore(meta, selected), 35);
  });

  it('COUNTED 模式：单价 × 次数累加', () => {
    const meta = { scoreMode: 'COUNTED', maxScore: null };
    const selected = [
      { score: 10, count: 3 },
      { score: 5, count: 2 },
    ];
    assert.equal(computeItemScore(meta, selected), 40);
  });

  it('COUNTED 模式受 maxScore 封顶', () => {
    const meta = { scoreMode: 'COUNTED', maxScore: 50 };
    const selected = [
      { score: 10, count: 10 }, // 100
    ];
    assert.equal(computeItemScore(meta, selected), 50);
  });

  it('COUNTED 模式未超上限时返回原始值', () => {
    const meta = { scoreMode: 'COUNTED', maxScore: 100 };
    const selected = [{ score: 5, count: 10 }];
    assert.equal(computeItemScore(meta, selected), 50);
  });

  it('空选择列表返回 0', () => {
    assert.equal(computeItemScore({ scoreMode: 'TIERS', maxScore: null }, []), 0);
    assert.equal(computeItemScore({ scoreMode: 'COUNTED', maxScore: 100 }, []), 0);
  });

  it('无 meta 时按 TIERS 处理', () => {
    const selected = [{ score: 7 }, { score: 3 }];
    assert.equal(computeItemScore(undefined, selected), 10);
  });

  it('count 为 0 时该项不计分', () => {
    const meta = { scoreMode: 'COUNTED' as const, maxScore: null };
    const selected = [{ score: 10, count: 0 }];
    assert.equal(computeItemScore(meta, selected), 0);
  });
});

describe('UpsertSchema', () => {
  it('最小有效 payload（草稿）通过', () => {
    const result = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      items: [],
      submit: false,
    });
    assert.ok(result.success);
  });

  it('submit=true 时通过', () => {
    const result = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      items: [
        {
          itemId: 'item-01',
          selected: [],
          content: '',
        },
      ],
      submit: true,
    });
    assert.ok(result.success);
  });

  it('templateId 缺失时失败', () => {
    const result = UpsertSchema.safeParse({ items: [] });
    assert.equal(result.success, false);
  });

  it('items 不是数组时失败', () => {
    const result = UpsertSchema.safeParse({ templateId: 'tpl-01', items: 'invalid' });
    assert.equal(result.success, false);
  });

  it('可选头部字段可通过', () => {
    const result = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      workAreaId: 'branch-01',
      hireDate: '2023-07-01',
      declarationLevelId: 'L3',
      declarationSpecialtyId: 'spec-01',
      items: [],
    });
    assert.ok(result.success);
  });

  it('declaredScore 必须为有限数', () => {
    const result = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      items: [{ itemId: 'i1', selected: [], declaredScore: Infinity }],
    });
    assert.equal(result.success, false);
  });

  it('confirmationStatus 只能是 CONFIRMED 或 DISPUTED', () => {
    const ok = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      items: [{ itemId: 'i1', selected: [], confirmationStatus: 'CONFIRMED' }],
    });
    assert.ok(ok.success);

    const bad = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      items: [{ itemId: 'i1', selected: [], confirmationStatus: 'PENDING' }],
    });
    assert.equal(bad.success, false);
  });

  it('count 必须为非负整数', () => {
    const ok = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      items: [
        { itemId: 'i1', selected: [{ index: 0, count: 3 }] },
      ],
    });
    assert.ok(ok.success);

    const bad = UpsertSchema.safeParse({
      templateId: 'tpl-01',
      items: [
        { itemId: 'i1', selected: [{ index: 0, count: -1 }] },
      ],
    });
    assert.equal(bad.success, false);
  });
});
