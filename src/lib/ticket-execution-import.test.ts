import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkTicketPrice,
  DEFAULT_TICKET_PRICES,
  type TicketPriceConfig,
} from './ticket-execution-import';

describe('resolveWorkTicketPrice', () => {
  it('默认表：总工作票负责人=5', () => {
    assert.equal(resolveWorkTicketPrice('workLeader', '总工作票'), 5);
    assert.equal(resolveWorkTicketPrice('workPermitter', '总工作票'), 1.5);
    assert.equal(resolveWorkTicketPrice('workMember', '单班组一种票'), 1.5);
  });

  it('未配置票种类 → 0', () => {
    assert.equal(resolveWorkTicketPrice('workMember', '总工作票'), 0);
    assert.equal(resolveWorkTicketPrice('workLeader', '未知票种'), 0);
  });

  it('传入自定义价格表改变分数（验证不依赖硬编码）', () => {
    const custom: TicketPriceConfig = {
      operationStepPrice: 0.02,
      workLeader: { 特殊票: 9 },
      workPermitter: {},
      workMember: {},
    };
    assert.equal(resolveWorkTicketPrice('workLeader', '特殊票', custom), 9);
    // 默认表的「总工作票」在自定义表里不存在 → 0
    assert.equal(resolveWorkTicketPrice('workLeader', '总工作票', custom), 0);
  });

  it('票种显式映射为 0 时取 0，而非跳过（hasOwnProperty 语义）', () => {
    const custom: TicketPriceConfig = {
      operationStepPrice: 0.01,
      workLeader: { 总工作票: 0 },
      workPermitter: {},
      workMember: {},
    };
    assert.equal(resolveWorkTicketPrice('workLeader', '总工作票', custom), 0);
  });
});

describe('DEFAULT_TICKET_PRICES', () => {
  it('operationStepPrice = 0.01', () => {
    assert.equal(DEFAULT_TICKET_PRICES.operationStepPrice, 0.01);
  });
  it('与量化积分表一致的分值', () => {
    assert.equal(DEFAULT_TICKET_PRICES.workLeader['分工作票'], 3);
    assert.equal(DEFAULT_TICKET_PRICES.workPermitter['二种票'], 0.3);
    assert.equal(DEFAULT_TICKET_PRICES.workMember['二种票'], 0.5);
  });
});
