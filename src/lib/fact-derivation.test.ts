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

describe('buildDerivation — MATRIX_SUM (缺陷治理)', () => {
  it('展示每条缺陷的矩阵查表得分', () => {
    const facts: DerivationInputFact[] = [
      { id: 'd1', defectRef: 'D001', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 3 },
      { id: 'd2', defectRef: 'D002', defectLevel: '一般', role: 'FIRST_DISCOVERER', score: 0.5 },
    ];
    const d = buildDerivation('worksite.defect-governance', facts, { finalScore: 3.5 })!;
    assert.equal(d.ruleType, 'MATRIX_SUM');
    assert.ok(d.steps.some((s) => /D001.*危急.*第一发现人.*矩阵查表 3/.test(s.label)));
    assert.ok(d.steps.some((s) => /D002.*一般.*第一发现人.*0\.5/.test(s.label)));
    assert.ok(d.steps.some((s) => /小计原始分 3\.5/.test(s.label)));
  });

  it('同缺陷多条事实且合计超过单条最高时触发取高提示', () => {
    // 引擎导入时按 (employeeNo, defectLevel) 取最高角色分落库；正常情况同缺陷只有 1 条。
    // 但若数据中同缺陷出现多条（如不同来源重复），且合计 > 单条最高，展示取高提示。
    const facts: DerivationInputFact[] = [
      { id: 'd1', defectRef: 'D001', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 3 },
      { id: 'd2', defectRef: 'D001', defectLevel: '严重', role: 'FIRST_HANDLER', score: 1 },
    ];
    const d = buildDerivation('worksite.defect-governance', facts, { finalScore: 4 })!;
    assert.ok(d.steps.some((s) => /同人 D001.*取高.*3/.test(s.label)), JSON.stringify(d.steps));
  });

  it('触顶显示封顶（maxScore=12）', () => {
    const facts: DerivationInputFact[] = [
      { id: 'd1', defectRef: 'D001', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 6 },
      { id: 'd2', defectRef: 'D002', defectLevel: '危急', role: 'FIRST_DISCOVERER', score: 6 },
    ];
    const d = buildDerivation('worksite.defect-governance', facts, { finalScore: 12 })!;
    assert.ok(d.steps.some((s) => s.kind === 'cap' && /封顶 12/.test(s.label)));
  });
});

describe('buildDerivation — NORMALIZE (两票执行)', () => {
  it('逐票事实按员工原始分求和，并按参与角色汇总计算过程', () => {
    const facts: DerivationInputFact[] = [
      {
        id: 't1',
        score: 0.01,
        metadata: { scoreCategory: 'operationPoints' },
      },
      {
        id: 't2',
        score: 5,
        metadata: { scoreCategory: 'workLeaderPoints' },
      },
      {
        id: 't3',
        score: 0.3,
        metadata: { scoreCategory: 'workPermitterPoints' },
      },
    ];

    const d = buildDerivation(
      'worksite.ticket-execution',
      facts,
      { finalScore: 15.9, ticketCohortMax: 10 },
    )!;

    assert.ok(d.steps.some((step) => /操作票 1 张 × 0\.01 = 0\.01/.test(step.label)));
    assert.ok(d.steps.some((step) => /工作票负责人得分 5/.test(step.label)));
    assert.ok(d.steps.some((step) => /工作票许可人得分 0\.3/.test(step.label)));
    assert.ok(d.steps.some((step) => /原始分 5\.31/.test(step.label)));
    assert.ok(d.steps.some((step) => /5\.31 \/ 10 × 30 = 15\.93/.test(step.label)));
  });

  it('两段式：breakdown→原始分，再按专业最高折算', () => {
    const facts: DerivationInputFact[] = [
      {
        id: 't1',
        score: 18.5,
        metadata: {
          isRawScore: true,
          breakdown: { operationItems: 150, operationPoints: 1.5, workLeaderPoints: 10, workPermitterPoints: 3, workMemberPoints: 4, operationTicketCount: 150, workTicketCount: 5 },
        },
        sourceFile: '10-13.两票数据汇总.xlsx',
      },
    ];
    const d = buildDerivation('worksite.ticket-execution', facts, { finalScore: 27.8, ticketCohortMax: 20 })!;
    assert.equal(d.ruleType, 'NORMALIZE');
    // 第一段：操作票项数 × 单价
    assert.ok(d.steps.some((s) => /操作票 150 项 × 0\.01 = 1\.5/.test(s.label)), JSON.stringify(d.steps));
    // 第一段：工作票负责人得分
    assert.ok(d.steps.some((s) => /工作票负责人.*10/.test(s.label)));
    // 原始分小计
    assert.ok(d.steps.some((s) => /原始分 18\.5/.test(s.label)));
    // 专业最高
    assert.ok(d.steps.some((s) => /专业最高原始分 20/.test(s.label)));
    // 第二段折算
    assert.ok(d.steps.some((s) => /18\.5 \/ 20 × 30 = 27\.75/.test(s.label)));
    // 最终（四舍五入）
    assert.ok(d.steps.some((s) => s.kind === 'final' && /27\.8.*四舍五入/.test(s.label)));
  });

  it('breakdown 缺失时聚合显示原始分并补注', () => {
    const facts: DerivationInputFact[] = [
      { id: 't1', score: 18.5, metadata: { isRawScore: true }, sourceFile: 'x.xlsx' },
    ];
    const d = buildDerivation('worksite.ticket-execution', facts, { finalScore: 27.8, ticketCohortMax: 20 })!;
    assert.ok(d.steps.some((s) => /原始分 18\.5/.test(s.label) && /明细未导入|聚合/.test(s.detail ?? s.label)));
  });

  it('无事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('worksite.ticket-execution', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});

describe('buildDerivation — DEDUCTION (违章扣分)', () => {
  it('展示每条违章扣分并累加', () => {
    const facts: DerivationInputFact[] = [
      { id: 'v1', defectRef: 'Z001', role: '直接责任人', score: -10 },
      { id: 'v2', defectRef: 'Z002', role: '连带责任人', score: -5 },
    ];
    const d = buildDerivation('special.violation-severe', facts, { finalScore: -15 })!;
    assert.equal(d.ruleType, 'DEDUCTION');
    assert.ok(d.steps.some((s) => /Z001.*直接责任人.*-10/.test(s.label)));
    assert.ok(d.steps.some((s) => /Z002.*连带责任人.*-5/.test(s.label)));
    assert.ok(d.steps.some((s) => s.kind === 'subtotal' && /小计 -15/.test(s.label)));
    // 扣分不封顶：无 cap 步骤
    assert.equal(d.steps.find((s) => s.kind === 'cap'), undefined);
  });

  it('无违章事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('special.violation-severe', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});

describe('buildDerivation — MANUAL (技术贡献/竞赛/创新)', () => {
  it('技术贡献：按细分维度汇总并封顶', () => {
    const facts: DerivationInputFact[] = [
      { id: 'x1', thirdLevelTitle: '教材/题库/课件开发', label: '教材', score: 6 },
      { id: 'x2', thirdLevelTitle: '运规编写/会审', label: '运规', score: 2 },
    ];
    const d = buildDerivation('performance.technical-contribution', facts, { finalScore: 8 })!;
    assert.ok(d.steps.some((s) => /教材\/题库\/课件开发.*6/.test(s.label)));
    assert.ok(d.steps.some((s) => /运规编写\/会审.*2/.test(s.label)));
    assert.ok(d.steps.some((s) => s.kind === 'subtotal' && /小计 8/.test(s.label)));
  });

  it('触顶显示封顶 12', () => {
    const facts: DerivationInputFact[] = [
      { id: 'x1', thirdLevelTitle: '教材/题库/课件开发', score: 8 },
      { id: 'x2', thirdLevelTitle: '运规编写/会审', score: 6 },
    ];
    const d = buildDerivation('performance.technical-contribution', facts, { finalScore: 12 })!;
    assert.ok(d.steps.some((s) => s.kind === 'cap' && /封顶 12/.test(s.label)));
  });

  it('无事实返回 emptyFactsSteps', () => {
    const d = buildDerivation('performance.competition', [], { finalScore: 0 })!;
    assert.match(d.steps[0]!.label, /暂无导入事实/);
  });
});

describe('buildDerivation — overrideScore 提示', () => {
  it('overrideScore 与原始推算不一致时前置提示', () => {
    const facts: DerivationInputFact[] = [
      { id: 's1', tierValue: '技师', score: 3 },
    ];
    // 系统原始推算 3 分，审核员改为 5 分
    const d = buildDerivation('basic.skill-level', facts, { finalScore: 5, overrideScore: 5 })!;
    const note = d.steps.find((s) => s.kind === 'note');
    assert.ok(note, '应包含 note 步骤');
    assert.match(note!.label, /审核员调整为 5 分.*原始推算.*3 分/);
    // note 在最前
    assert.equal(d.steps[0]!.kind, 'note');
  });

  it('overrideScore 与原始推算一致时不加提示', () => {
    const facts: DerivationInputFact[] = [
      { id: 's1', tierValue: '技师', score: 3 },
    ];
    const d = buildDerivation('basic.skill-level', facts, { finalScore: 3, overrideScore: 3 })!;
    assert.equal(d.steps.find((s) => s.kind === 'note'), undefined);
  });
});
