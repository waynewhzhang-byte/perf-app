import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDerivedFactCorrection } from './fact-correction-performance';

describe('buildDerivedFactCorrection', () => {
  it('keeps an explicitly provincial innovation award at the provincial QC score', () => {
    const fact = buildDerivedFactCorrection({
      dimensionCode: 'performance.innovation',
      year: 2026,
      employeeNo: '30137594',
      employeeName: '李鹏',
      sourceFile: 'appeal-correction:submission',
      award: '中国质量改进和创新活动全国QC发表赛一等奖',
      level: '省公司级获奖成果',
      project: '示例项目',
    });

    assert.equal(fact.dimensionCode, 'performance.innovation.award');
    assert.equal(fact.score, 2);
  });

  it('derives violation deductions from the selected severity and responsibility', () => {
    const fact = buildDerivedFactCorrection({
      dimensionCode: 'special.violation-general',
      year: 2026,
      employeeNo: '30137594',
      employeeName: '李鹏',
      sourceFile: 'appeal-correction:submission',
      violationRole: '连带责任人',
      description: '违章事项',
    });

    assert.equal(fact.dimensionCode, 'special.violation-general');
    assert.equal(fact.score, -2.5);
  });

  it('derives technical-contribution and competition facts into their scoring subdimensions', () => {
    const technical = buildDerivedFactCorrection({
      dimensionCode: 'performance.technical-contribution', year: 2026,
      employeeNo: '30137594', employeeName: '李鹏', sourceFile: 'appeal-correction:submission',
      subtype: 'regulation', project: '运规编写', category: '会审人员',
    });
    const competition = buildDerivedFactCorrection({
      dimensionCode: 'performance.competition', year: 2026,
      employeeNo: '30137594', employeeName: '李鹏', sourceFile: 'appeal-correction:submission',
      award: '省公司调考', level: '省公司级', category: '调考',
    });

    assert.equal(technical.dimensionCode, 'performance.technical-contribution.regulation');
    assert.equal(technical.score, 2);
    assert.equal(competition.dimensionCode, 'performance.competition.exam');
    assert.equal(competition.score, 2);
  });

  it('derives a severe violation as its own deduction dimension', () => {
    const fact = buildDerivedFactCorrection({
      dimensionCode: 'special.violation-severe', year: 2026,
      employeeNo: '30137594', employeeName: '李鹏', sourceFile: 'appeal-correction:submission',
      violationRole: '直接责任人', description: '严重违章事项',
    });

    assert.equal(fact.dimensionCode, 'special.violation-severe');
    assert.equal(fact.score, -10);
  });
});
