import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEmployeeDimensions } from './dimension-aggregation';
import { buildPerformanceScoreSheet } from './performance-score-sheet';

describe('buildPerformanceScoreSheet', () => {
  const baseInput = {
    year: 2025,
    employeeNo: '001',
    employeeName: '测试',
    declarationTier: '一级' as const,
    templateItems: [
      { id: 'i1', title: '技能等级（满分4分）' },
      { id: 'i2', title: '安全贡献（满分12分）' },
      { id: 'i3', title: '两票执行（满分30分）' },
      { id: 'i4', title: '缺陷治理（满分12分）' },
    ],
    basicFacts: [
      { id: 'b1', dimension: 'SKILL_LEVEL' as const, tierValue: '技师', score: 3 },
      { id: 'b2', dimension: 'TITLE_LEVEL' as const, tierValue: '副高级', score: 4 },
      { id: 'b3', dimension: 'PERFORMANCE_LEVEL' as const, tierValue: '2A1B', score: 5.5 },
    ],
    performanceFacts: [
      {
        id: 'p1',
        dimensionCode: 'worksite.ticket-execution',
        score: 50,
        metadata: {},
      },
      {
        id: 'p2',
        dimensionCode: 'worksite.defect-governance',
        score: 1,
        defectRef: 'D-1',
        defectLevel: '严重',
      },
      {
        id: 'p3',
        dimensionCode: 'worksite.defect-governance',
        score: 3,
        defectRef: 'D-2',
        defectLevel: '危急',
      },
      {
        id: 'p4',
        dimensionCode: 'performance.safety-contribution',
        score: 3,
        defectRef: 'CB001',
        role: 'FIRST_DISCOVERER',
      },
      {
        id: 'p5',
        dimensionCode: 'performance.safety-contribution',
        score: 3,
        defectRef: 'CB002',
        role: 'CO_DISCOVERER',
      },
    ],
    ticketCohortMax: 50,
    submissionItems: [
      { itemId: 'i2', score: 6, selected: [{ label: '第一发现人2次', score: 3, count: 2 }] },
    ],
  };

  it('事实维度用 FACT，无事实用手工', () => {
    const sheet = buildPerformanceScoreSheet(baseInput);
    const basic = sheet.sections.find((s) => s.code === 'basic')!;
    assert.equal(basic.score, 12.5);
    assert.equal(basic.items.find((i) => i.dimensionCode === 'basic.skill-level')?.source, 'FACT');

    // safety 现为系统导入维度（fact）：从 PerformanceFact 取分，累加封顶 12
    const safety = sheet.sections
      .find((s) => s.code === 'performance')!
      .items.find((i) => i.dimensionCode === 'performance.safety-contribution')!;
    assert.equal(safety.source, 'FACT');
    assert.equal(safety.score, 6); // 3 + 3

    const ticket = sheet.sections
      .find((s) => s.code === 'worksite')!
      .items.find((i) => i.dimensionCode === 'worksite.ticket-execution')!;
    assert.equal(ticket.source, 'FACT');
    assert.equal(ticket.score, 30);

    const defect = sheet.sections
      .find((s) => s.code === 'worksite')!
      .items.find((i) => i.dimensionCode === 'worksite.defect-governance')!;
    assert.equal(defect.score, 4);
  });

  it('无导入事实时 fact 维度得 0', () => {
    const sheet = buildPerformanceScoreSheet({
      ...baseInput,
      basicFacts: [],
      performanceFacts: [],
      submissionItems: [],
    });
    const skill = sheet.sections
      .find((s) => s.code === 'basic')!
      .items.find((i) => i.dimensionCode === 'basic.skill-level')!;
    assert.equal(skill.score, 0);
    assert.equal(skill.source, 'NONE');
  });

  it('模板定义的两类违章在无事实时仍保留 0 分确认项', () => {
    const sheet = buildPerformanceScoreSheet({
      year: 2026,
      employeeNo: '001',
      employeeName: '测试',
      templateItems: [
        { id: 'severe', title: '严重违章扣分', dimensionCode: 'special.violation-severe' },
        { id: 'general', title: '一般违章扣分', dimensionCode: 'special.violation-general' },
      ],
      basicFacts: [],
      performanceFacts: [],
    });
    const special = sheet.sections.find((section) => section.code === 'special')!;
    assert.equal(special.items.length, 2);
    assert.equal(special.items.every((item) => item.score === 0), true);
  });

  it('归档申报事实优先于申报草稿计分', () => {
    const sheet = buildPerformanceScoreSheet({
      ...baseInput,
      submissionFacts: [
        {
          id: 'sf1',
          dimensionCode: 'performance.safety-contribution',
          label: '第一发现人',
          score: 6,
          count: 2,
          unitScore: 3,
        },
      ],
      submissionItems: [
        { itemId: 'i2', score: 3, selected: [{ label: '草稿选项', score: 3 }] },
      ],
    });
    const safety = sheet.sections
      .flatMap((s) => s.items)
      .find((r) => r.dimensionCode === 'performance.safety-contribution');
    assert.equal(safety?.score, 6);
    assert.equal(safety?.source, 'FACT');
  });

  it('两票按同专业最高原始分折算到 30 分', () => {
    const sheet = buildPerformanceScoreSheet({
      year: 2025,
      employeeNo: '001',
      employeeName: '测试',
      templateItems: [{ id: 'i3', title: '两票执行（满分30分）' }],
      basicFacts: [],
      performanceFacts: [
        { id: 'p1', dimensionCode: 'worksite.ticket-execution', score: 45 },
      ],
      ticketCohortMax: 90,
    });
    const ticket = sheet.sections
      .find((s) => s.code === 'worksite')!
      .items.find((i) => i.dimensionCode === 'worksite.ticket-execution')!;
    assert.equal(ticket.score, 15);
  });

  it('profile.mockDeclarationTier 优先于入职推算能级', () => {
    const sheet = buildPerformanceScoreSheet({
      year: 2025,
      employeeNo: '001',
      employeeName: '测试',
      hireDate: new Date('2010-01-01'),
      mockDeclarationTier: '一级',
      templateItems: [],
      basicFacts: [],
      performanceFacts: [],
    });
    assert.equal(sheet.declarationTier, '一级');
  });
});

describe('score sheet fact totals ↔ dimension aggregation parity', () => {
  const fixture = {
    employeeNo: 'parity-001',
    basicFacts: [
      { dimension: 'SKILL_LEVEL' as const, score: 3, tierValue: '技师' },
      { dimension: 'TITLE_LEVEL' as const, score: 2, tierValue: '//' },
      { dimension: 'PERFORMANCE_LEVEL' as const, score: 5.5, tierValue: '2A1B' },
    ],
    performanceFacts: [
      { dimensionCode: 'worksite.defect-governance', score: 0.5 },
      { dimensionCode: 'worksite.defect-governance', score: 1 },
      { dimensionCode: 'performance.safety-contribution', score: 20 },
      { dimensionCode: 'worksite.ticket-execution', score: 0.06 },
      { dimensionCode: 'performance.technical-contribution.textbook', score: 6 },
      { dimensionCode: 'performance.technical-contribution.regulation', score: 4 },
      { dimensionCode: 'performance.technical-contribution.ticket-revision', score: 4 },
      { dimensionCode: 'special.violation-severe', score: -2 },
    ],
    ticketCohortMax: 0.11,
  };

  it('fact 维度得分与 aggregateEmployeeDimensions 一致', () => {
    const totals = aggregateEmployeeDimensions({
      employeeNo: fixture.employeeNo,
      performanceFacts: fixture.performanceFacts,
      basicFacts: fixture.basicFacts,
      ticketCohortMax: fixture.ticketCohortMax,
    });

    const sheet = buildPerformanceScoreSheet({
      year: 2026,
      employeeNo: fixture.employeeNo,
      employeeName: '对照',
      templateItems: [],
      basicFacts: fixture.basicFacts.map((f, i) => ({
        id: `b${i}`,
        dimension: f.dimension,
        tierValue: f.tierValue,
        score: f.score,
      })),
      performanceFacts: fixture.performanceFacts.map((f, i) => ({
        id: `p${i}`,
        dimensionCode: f.dimensionCode,
        score: f.score,
      })),
      ticketCohortMax: fixture.ticketCohortMax,
    });

    const factCodes = [
      'basic.skill-level',
      'basic.performance-level',
      'worksite.defect-governance',
      'performance.safety-contribution',
      'worksite.ticket-execution',
      'performance.technical-contribution',
    ];

    for (const code of factCodes) {
      const row = sheet.sections.flatMap((s) => s.items).find((i) => i.dimensionCode === code);
      assert.ok(row, `missing sheet row ${code}`);
      assert.equal(row!.source, 'FACT', code);
      assert.equal(row!.score, totals.byCode[code]?.score, `score mismatch ${code}`);
    }

    // 空档位不进聚合、分表也为 0 / NONE
    const title = sheet.sections.flatMap((s) => s.items).find((i) => i.dimensionCode === 'basic.title-level');
    assert.equal(title?.score, 0);
    assert.equal(totals.byCode['basic.title-level'], undefined);
  });

  it('未传 ticketCohortMax 时分表与「本人 raw 当地最高」的聚合一致', () => {
    const performanceFacts = [{ dimensionCode: 'worksite.ticket-execution', score: 45 }];
    const totals = aggregateEmployeeDimensions({
      employeeNo: 't1',
      performanceFacts,
      ticketCohortMax: 45,
    });
    const sheet = buildPerformanceScoreSheet({
      year: 2026,
      employeeNo: 't1',
      employeeName: '票',
      templateItems: [],
      basicFacts: [],
      performanceFacts: performanceFacts.map((f) => ({ id: 'p1', ...f })),
    });
    const ticket = sheet.sections.flatMap((s) => s.items).find((i) => i.dimensionCode === 'worksite.ticket-execution');
    assert.equal(ticket?.score, 30);
    assert.equal(ticket?.score, totals.byCode['worksite.ticket-execution']?.score);
  });
});
