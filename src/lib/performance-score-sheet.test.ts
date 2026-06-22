import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    ticketTierMaxRaw: { 一级: 50, 二级: 60, 三级: 40 },
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
    assert.equal(ticket.score, 50);

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

  it('两票导入阶段展示原始分，不做封顶折算', () => {
    const sheet = buildPerformanceScoreSheet({
      year: 2025,
      employeeNo: '001',
      employeeName: '测试',
      templateItems: [{ id: 'i3', title: '两票执行（满分30分）' }],
      basicFacts: [],
      performanceFacts: [
        { id: 'p1', dimensionCode: 'worksite.ticket-execution', score: 45 },
      ],
    });
    const ticket = sheet.sections
      .find((s) => s.code === 'worksite')!
      .items.find((i) => i.dimensionCode === 'worksite.ticket-execution')!;
    assert.equal(ticket.score, 45);
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
