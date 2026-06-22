import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkTicketPrice,
  DEFAULT_TICKET_PRICES,
  isOperationTicketEligible,
  aggregateTicketExecutionRows,
  type TicketPriceConfig,
} from './ticket-execution-import';

describe('isOperationTicketEligible', () => {
  it('接受已归档、归档、已执行', () => {
    assert.equal(isOperationTicketEligible('已归档'), true);
    assert.equal(isOperationTicketEligible('归档'), true);
    assert.equal(isOperationTicketEligible('已执行'), true);
    assert.equal(isOperationTicketEligible('作废'), false);
  });
});

describe('aggregateTicketExecutionRows', () => {
  const resolver = {
    resolve(name: string) {
      const map: Record<string, { employeeNo: string; employeeName: string }> = {
        张三: { employeeNo: 'E001', employeeName: '张三' },
        李四: { employeeNo: 'E002', employeeName: '李四' },
      };
      return map[name] ?? null;
    },
  };

  it('操作票：每行每角色 0.01 分，与操作步数无关', () => {
    const opRows = [{
      单位: '测试',
      票状态: '已执行',
      实际操作步数: '54',
      操作人: '张三',
      监护人: '李四',
      值班负责人: '张三',
      现场配合人员: '李四',
    }];
    const result = aggregateTicketExecutionRows(opRows, [], resolver);
    assert.equal(result.aggregates.length, 2);
    const zhang = result.byEmployeeNo.get('E001')!;
    assert.equal(zhang.rawScore, 0.02); // 操作人 + 值班负责人 各 0.01
    assert.equal(zhang.breakdown.operationItems, 2);
  });

  it('操作票：步数为 0 仍计分', () => {
    const opRows = [{
      单位: '测试',
      票状态: '归档',
      实际操作步数: '0',
      操作人: '张三',
      监护人: '',
      值班负责人: '',
      现场配合人员: '',
    }];
    const result = aggregateTicketExecutionRows(opRows, [], resolver);
    assert.equal(result.byEmployeeNo.get('E001')!.rawScore, 0.01);
  });

  it('工作票：总工作票负责人 5 分', () => {
    const workRows = [{
      单位: '测试',
      票种类: '总工作票',
      工作负责人: '张三',
      开工许可人: '',
      完工许可人: '',
      专责监护: '',
    }];
    const result = aggregateTicketExecutionRows([], workRows, resolver);
    assert.equal(result.aggregates[0].rawScore, 5);
    assert.equal(result.aggregates[0].breakdown.workLeaderPoints, 5);
  });
});

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
