import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultScoringRuleConfigs } from './scoring-standards';

describe('defaultScoringRuleConfigs', () => {
  const cfgs = defaultScoringRuleConfigs();
  const codes = cfgs.map((c) => c.dimensionCode);

  it('覆盖 4 个系统导入维度共 6 条规则', () => {
    const expected = [
      'basic.skill-level',
      'basic.title-level',
      'basic.performance-level',
      'worksite.defect-governance',
      'worksite.ticket-execution',
      'performance.safety-contribution',
    ];
    for (const c of expected) {
      assert.ok(codes.includes(c), `missing ${c}`);
    }
    assert.equal(cfgs.length, 6);
  });

  it('每条规则携带 dimensionName', () => {
    for (const c of cfgs) {
      assert.ok((c as { dimensionName?: string }).dimensionName, `${c.dimensionCode} 缺 dimensionName`);
    }
  });

  it('basic.skill-level 是 BASIC_TIER，含高级技师=4', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'basic.skill-level')!;
    assert.equal(c.ruleType, 'BASIC_TIER');
    const cfg = c.config as { tiers: Record<string, number>; defaultScore: number };
    assert.equal(cfg.tiers['高级技师'], 4);
    assert.equal(cfg.defaultScore, 1);
  });

  it('basic.title-level 含副高级=4', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'basic.title-level')!;
    const cfg = c.config as { tiers: Record<string, number> };
    assert.equal(cfg.tiers['副高级'], 4);
  });

  it('basic.performance-level 含 2A1B=5.5', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'basic.performance-level')!;
    const cfg = c.config as { tiers: Record<string, number> };
    assert.equal(cfg.tiers['2A1B'], 5.5);
  });

  it('ticket NORMALIZE 含 operationStepPrice + ticketPrices', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'worksite.ticket-execution')!;
    assert.equal(c.ruleType, 'NORMALIZE');
    const cfg = c.config as { operationStepPrice: number; ticketPrices: Record<string, Record<string, number>> };
    assert.equal(cfg.operationStepPrice, 0.01);
    assert.equal(cfg.ticketPrices.workLeader['总工作票'], 5);
    assert.equal(cfg.ticketPrices.workPermitter['总工作票'], 1.5);
    assert.equal(cfg.ticketPrices.workMember['单班组一种票'], 1.5);
  });

  it('safety SHARE 含 perIncident=3', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'performance.safety-contribution')!;
    assert.equal(c.ruleType, 'SHARE');
    const cfg = c.config as { roles: Record<string, { perIncident?: number }> };
    assert.equal(cfg.roles.FIRST_DISCOVERER.perIncident, 3);
  });

  it('defect MATRIX 含危急第一发现人=3', () => {
    const c = cfgs.find((x) => x.dimensionCode === 'worksite.defect-governance')!;
    assert.equal(c.ruleType, 'MATRIX');
    const cfg = c.config as { matrix: Record<string, Record<string, number>> };
    assert.equal(cfg.matrix['危急'].FIRST_DISCOVERER, 3);
  });
});
