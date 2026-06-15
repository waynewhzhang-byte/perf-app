/**
 * 评分规则引擎测试
 *
 * 覆盖三种规则类型：MATRIX（矩阵映射）、SHARE（聚合均分）、NORMALIZE（折算归一）
 * 参考：docs/superpowers/specs/2026-06-13-architecture-decisions.md 原则 7
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFactScores,
  type ScoringRule,
  type FactInput,
} from './scoring-engine';

// ── 测试辅助 ────────────────────────────────────────────────────

function defRule(overrides: Partial<ScoringRule> = {}): ScoringRule {
  return {
    id: 'rule-defect',
    dimensionCode: 'worksite.defect-governance',
    ruleType: 'MATRIX',
    cap: 12,
    enabled: true,
    matrix: {
      '危急': { FIRST_DISCOVERER: 3, CO_DISCOVERER: 1, FIRST_HANDLER: 3, CO_HANDLER: 1 },
      '严重': { FIRST_DISCOVERER: 1, CO_DISCOVERER: 0.5, FIRST_HANDLER: 1, CO_HANDLER: 0.5 },
      '一般': { FIRST_DISCOVERER: 0.5, FIRST_HANDLER: 0.5 },
    },
    ...overrides,
  };
}

function safetyRule(overrides: Partial<ScoringRule> = {}): ScoringRule {
  return {
    id: 'rule-safety',
    dimensionCode: 'performance.safety-contribution',
    ruleType: 'SHARE',
    cap: 12,
    enabled: true,
    roles: {
      FIRST_DISCOVERER: { perIncident: 3, multiplyByFaultCount: true },
      CO_DISCOVERER: { totalShare: 3, multiplyByFaultCount: true, splitAmong: 'CO_DISCOVERER' },
    },
    groupBy: 'incidentId',
    ...overrides,
  };
}

function ticketRule(overrides: Partial<ScoringRule> = {}): ScoringRule {
  return {
    id: 'rule-ticket',
    dimensionCode: 'worksite.ticket-execution',
    ruleType: 'NORMALIZE',
    cap: 30,
    enabled: true,
    targetMaxScore: 30,
    normalizeWithin: 'declarationLevel',
    ...overrides,
  };
}

function fact(overrides: Partial<FactInput> = {}): FactInput {
  return {
    employeeNo: 'EMP-001',
    employeeName: '测试员工',
    dimensionCode: 'worksite.defect-governance',
    role: 'FIRST_DISCOVERER',
    eventType: 'DISCOVERY',
    defectLevel: '严重',
    sourceFile: 'test.xlsx',
    ...overrides,
  };
}

// ── MATRIX 测试 ─────────────────────────────────────────────────

describe('MATRIX (缺陷治理)', () => {
  it('危急第一发现人得 3 分', () => {
    const facts = [fact({ defectLevel: '危急', role: 'FIRST_DISCOVERER' })];
    const results = computeFactScores(facts, [defRule()]);
    assert.equal(results.length, 1);
    assert.equal(results[0].score, 3);
  });

  it('严重第一发现人得 1 分，共同发现人得 0.5 分', () => {
    const facts = [
      fact({ employeeNo: 'A', defectLevel: '严重', role: 'FIRST_DISCOVERER' }),
      fact({ employeeNo: 'B', defectLevel: '严重', role: 'CO_DISCOVERER' }),
    ];
    const results = computeFactScores(facts, [defRule()]);
    const byEmp = new Map(results.map((r) => [r.employeeNo, r.score]));
    assert.equal(byEmp.get('A'), 1);
    assert.equal(byEmp.get('B'), 0.5);
  });

  it('一般缺陷第一发现人和第一处理人各 0.5 分', () => {
    const facts = [
      fact({ employeeNo: 'A', defectLevel: '一般', role: 'FIRST_DISCOVERER' }),
      fact({ employeeNo: 'B', defectLevel: '一般', role: 'FIRST_HANDLER', eventType: 'REMEDIATION' }),
    ];
    const results = computeFactScores(facts, [defRule()]);
    assert.equal(results.length, 2);
    for (const r of results) assert.equal(r.score, 0.5);
  });

  it('同人兼任发现和处理，取高分（tieBreak: MAX_PER_PERSON）', () => {
    const facts = [
      fact({ employeeNo: 'EMP-001', defectLevel: '危急', role: 'FIRST_DISCOVERER' }),
      fact({ employeeNo: 'EMP-001', defectLevel: '危急', role: 'CO_HANDLER', eventType: 'REMEDIATION' }),
    ];
    const results = computeFactScores(facts, [defRule()]);
    assert.equal(results.length, 1);
    assert.equal(results[0].score, 3);
  });

  it('封顶 12 分', () => {
    const rule = defRule({
      cap: 12,
      matrix: { '危急': { FIRST_DISCOVERER: 15 } },
    });
    const results = computeFactScores(
      [fact({ defectLevel: '危急', role: 'FIRST_DISCOVERER' })],
      [rule],
    );
    assert.equal(results[0].score, 12);
  });

  it('缺失缺陷等级的矩阵 → 得 0 分，不产出结果', () => {
    const results = computeFactScores([fact({ defectLevel: '不存在' })], [defRule()]);
    assert.equal(results.length, 0);
  });

  it('多人同一缺陷不同角色，各自得分', () => {
    const facts = [
      fact({ employeeNo: 'A', defectLevel: '危急', role: 'FIRST_DISCOVERER' }),
      fact({ employeeNo: 'B', defectLevel: '危急', role: 'CO_DISCOVERER' }),
      fact({ employeeNo: 'C', defectLevel: '危急', role: 'FIRST_HANDLER', eventType: 'REMEDIATION' }),
    ];
    const results = computeFactScores(facts, [defRule()]);
    assert.equal(results.length, 3);
    assert.equal(results.find((r) => r.employeeNo === 'A')!.score, 3);
    assert.equal(results.find((r) => r.employeeNo === 'B')!.score, 1);
    assert.equal(results.find((r) => r.employeeNo === 'C')!.score, 3);
  });
});

// ── SHARE 测试 ──────────────────────────────────────────────────

describe('SHARE (安全贡献)', () => {
  it('第一发现人 3 分/次，默认故障次数为 1', () => {
    const facts = [
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'FIRST_DISCOVERER' }),
        incidentId: 'CB001',
        faultCount: 1,
      },
    ];
    const results = computeFactScores(facts, [safetyRule()]);
    assert.equal(results.length, 1);
    assert.equal(results[0].score, 3);
  });

  it('N 处故障时第一发现人 3 × N 分', () => {
    const facts = [
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'FIRST_DISCOVERER' }),
        incidentId: 'CB001',
        faultCount: 2,
      },
    ];
    const results = computeFactScores(facts, [safetyRule()]);
    assert.equal(results[0].score, 6);
  });

  it('其他发现人合计 3 分/次，均分', () => {
    const facts = [
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'CO_DISCOVERER', employeeNo: 'A' }),
        incidentId: 'CB001',
        faultCount: 1,
      },
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'CO_DISCOVERER', employeeNo: 'B' }),
        incidentId: 'CB001',
        faultCount: 1,
      },
    ];
    const results = computeFactScores(facts, [safetyRule()]);
    assert.equal(results.length, 2);
    for (const r of results) assert.equal(r.score, 1.5);
  });

  it('N 处故障时 share 也乘以 N', () => {
    const employees = ['A', 'B', 'C', 'D'];
    const facts = employees.map((emp) => ({
      ...fact({ dimensionCode: 'performance.safety-contribution', role: 'CO_DISCOVERER', employeeNo: emp }),
      incidentId: 'CB002',
      faultCount: 2,
    }));
    const results = computeFactScores(facts, [safetyRule()]);
    assert.equal(results.length, 4);
    for (const r of results) assert.equal(r.score, 1.5);
  });

  it('封顶', () => {
    const rule = safetyRule({ cap: 5 });
    const facts = [
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'FIRST_DISCOVERER' }),
        incidentId: 'CB001',
        faultCount: 3,
      },
    ];
    const results = computeFactScores(facts, [rule]);
    assert.equal(results[0].score, 5);
  });

  it('多事件独立计算', () => {
    const facts = [
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'FIRST_DISCOVERER', employeeNo: 'A' }),
        incidentId: 'CB001',
        faultCount: 1,
      },
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'FIRST_DISCOVERER', employeeNo: 'A' }),
        incidentId: 'CB002',
        faultCount: 1,
      },
    ];
    const results = computeFactScores(facts, [safetyRule()]);
    assert.equal(results.length, 2);
    assert.equal(results[0].score, 3);
    assert.equal(results[1].score, 3);
  });
});

// ── NORMALIZE 测试 ──────────────────────────────────────────────

describe('NORMALIZE (两票执行)', () => {
  it('原始分按能级最高分折算到目标分', () => {
    const facts = [
      {
        ...fact({ dimensionCode: 'worksite.ticket-execution', employeeNo: 'A' }),
        rawScore: 15,
        declarationLevel: '一级',
      },
      {
        ...fact({ dimensionCode: 'worksite.ticket-execution', employeeNo: 'B' }),
        rawScore: 30,
        declarationLevel: '一级',
      },
    ];
    const results = computeFactScores(facts, [ticketRule()]);
    const a = results.find((r) => r.employeeNo === 'A')!;
    const b = results.find((r) => r.employeeNo === 'B')!;
    assert.equal(a.score, 15);
    assert.equal(b.score, 30);
  });

  it('不同能级独立折算', () => {
    const rule = ticketRule();
    const facts = [
      { ...fact({ dimensionCode: 'worksite.ticket-execution', employeeNo: 'A' }), rawScore: 33.5, declarationLevel: '一级' },
      { ...fact({ dimensionCode: 'worksite.ticket-execution', employeeNo: 'B' }), rawScore: 20, declarationLevel: '一级' },
      { ...fact({ dimensionCode: 'worksite.ticket-execution', employeeNo: 'C' }), rawScore: 59.5, declarationLevel: '二级' },
      { ...fact({ dimensionCode: 'worksite.ticket-execution', employeeNo: 'D' }), rawScore: 30, declarationLevel: '二级' },
    ];
    const results = computeFactScores(facts, [rule]);
    const b = results.find((r) => r.employeeNo === 'B')!;
    assert.ok(Math.abs(b.score - 17.91) < 0.1, `expected ~17.91, got ${b.score}`);
    const d = results.find((r) => r.employeeNo === 'D')!;
    assert.ok(Math.abs(d.score - 15.13) < 0.1, `expected ~15.13, got ${d.score}`);
    const a = results.find((r) => r.employeeNo === 'A')!;
    assert.equal(a.score, 30);
  });

  it('原始分全为 0 → 得 0 分', () => {
    const facts = [
      { ...fact({ dimensionCode: 'worksite.ticket-execution' }), rawScore: 0, declarationLevel: '一级' },
      { ...fact({ dimensionCode: 'worksite.ticket-execution', employeeNo: 'B' }), rawScore: 0, declarationLevel: '一级' },
    ];
    const results = computeFactScores(facts, [ticketRule()]);
    for (const r of results) assert.equal(r.score, 0);
  });

  it('封顶', () => {
    const rule = ticketRule({ cap: 30 });
    const facts = [
      { ...fact({ dimensionCode: 'worksite.ticket-execution' }), rawScore: 100, declarationLevel: '一级' },
    ];
    const results = computeFactScores(facts, [rule]);
    assert.equal(results[0].score, 30);
  });
});

// ── 边界情况 ────────────────────────────────────────────────────

describe('边界情况', () => {
  it('未启用规则 → 不计算', () => {
    const rule = defRule({ enabled: false });
    const results = computeFactScores([fact()], [rule]);
    assert.equal(results.length, 0);
  });

  it('未知维度 → 跳过', () => {
    const results = computeFactScores(
      [fact({ dimensionCode: 'unknown.dimension' })],
      [defRule()],
    );
    assert.equal(results.length, 0);
  });

  it('空事实列表 → 返回空', () => {
    assert.equal(computeFactScores([], [defRule()]).length, 0);
  });

  it('空规则列表 → 返回空', () => {
    assert.equal(computeFactScores([fact()], []).length, 0);
  });

  it('混合维度 → 各自规则处理', () => {
    const facts = [
      fact({ defectLevel: '危急', role: 'FIRST_DISCOVERER' }),
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'FIRST_DISCOVERER' }),
        incidentId: 'CB001',
        faultCount: 1,
      },
    ];
    const results = computeFactScores(facts, [defRule(), safetyRule()]);
    assert.equal(results.length, 2);
    assert.equal(results[0].score, 3);
    assert.equal(results[1].score, 3);
  });

  it('SHARE 没有 incidentId → 全部归入默认组', () => {
    const facts = [
      {
        ...fact({ dimensionCode: 'performance.safety-contribution', role: 'FIRST_DISCOVERER', employeeNo: 'A' }),
        faultCount: 1,
      },
    ];
    const results = computeFactScores(facts, [safetyRule()]);
    assert.equal(results.length, 1);
    assert.equal(results[0].score, 3);
  });
});
