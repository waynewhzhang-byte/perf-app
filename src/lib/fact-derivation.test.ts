import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDerivation, type DerivationInputFact } from './fact-derivation';

describe('buildDerivation — BASIC_TIER', () => {
  it('绩效等级：yearBreakdown 推导组合档位与得分', () => {
    const facts: DerivationInputFact[] = [
      {
        id: 'f1',
        tierValue: '1A2B',
        score: 5,
        label: '1A2B',
        yearBreakdown: { 2023: 'A', 2024: 'B', 2025: 'B' },
        thirdLevelTitle: '近三年绩效档位',
        sourceFile: '2.人员考核结果.xlsx',
      } as DerivationInputFact & { yearBreakdown: unknown },
    ];
    const d = buildDerivation('basic.performance-level', facts, { finalScore: 5 })!;
    assert.equal(d.ruleType, 'BASIC_TIER');
    assert.equal(d.steps.length, 2);
    assert.match(d.steps[0]!.label, /2023→A.*2024→B.*2025→B.*1A2B/);
    assert.equal(d.steps[1]!.label, '档位 1A2B → 5 分');
    assert.equal(d.referenceFile, '2.人员考核结果.xlsx');
  });

  it('技能等级：缺 yearBreakdown 时直接显示档位→得分', () => {
    const facts: DerivationInputFact[] = [
      { id: 'f1', tierValue: '技师', score: 3, sourceFile: '1.能级评价员工花名册.xlsx' },
    ];
    const d = buildDerivation('basic.skill-level', facts, { finalScore: 3 })!;
    assert.equal(d.steps.length, 1);
    assert.equal(d.steps[0]!.label, '档位 技师 → 3 分');
  });

  it('触顶时显示封顶步骤', () => {
    // 绩效等级 maxScore=6；构造一个等于上限的档位 3A(6分)
    const facts: DerivationInputFact[] = [
      { id: 'f1', tierValue: '3A', score: 6 },
    ];
    const d = buildDerivation('basic.performance-level', facts, { finalScore: 6 })!;
    const capStep = d.steps.find((s) => s.kind === 'cap');
    assert.equal(capStep?.label, '封顶 6');
  });

  it('无导入事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('basic.skill-level', [], { finalScore: 0 })!;
    assert.equal(d.steps.length, 1);
    assert.equal(d.steps[0]!.kind, 'note');
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});

describe('buildDerivation — SHARE (安全贡献)', () => {
  it('按事件分组展示第一发现人/共同发现人均分', () => {
    const facts: DerivationInputFact[] = [
      { id: 'a', defectRef: 'AQ001', role: 'FIRST_DISCOVERER', score: 6, sourceFile: '3.突出贡献奖人员汇总.xlsx' },
      { id: 'b', defectRef: 'AQ002', role: 'CO_DISCOVERER', score: 1.5, sourceFile: '3.突出贡献奖人员汇总.xlsx' },
      { id: 'c', defectRef: 'AQ002', role: 'CO_DISCOVERER', score: 1.5, sourceFile: '3.突出贡献奖人员汇总.xlsx' },
    ];
    const d = buildDerivation('performance.safety-contribution', facts, { finalScore: 9 })!;
    assert.equal(d.ruleType, 'SHARE');
    // 第一发现人事件 + 两个共同发现人事件 + 小计
    const subtotals = d.steps.filter((s) => s.kind === 'subtotal');
    assert.equal(subtotals.length, 1);
    assert.match(subtotals[0]!.label, /小计原始分 9/);
    // 每条事实对应一行（reverse-engineer 6 = 3×2、1.5 = 3÷2）
    assert.ok(d.steps.some((s) => /AQ001.*3 分\/次.*× 2 次.*= 6/.test(s.label)));
    assert.ok(d.steps.some((s) => /AQ002.*均分.*3 ÷ 2 = 1\.5/.test(s.label)));
  });

  it('无事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('performance.safety-contribution', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});
