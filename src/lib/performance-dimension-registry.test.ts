import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERFORMANCE_SECTIONS,
  PERFORMANCE_SUB_DIMENSIONS,
  buildPerformanceDimensionTree,
  defaultSectionTitle,
  isSubDimensionInSection,
  subDimensionsForSection,
} from './performance-dimension-registry';

describe('performance-dimension-registry', () => {
  it('一级维度与 Excel 序号 1–4 对齐', () => {
    assert.deepEqual(
      PERFORMANCE_SECTIONS.map((s) => s.excelOrder),
      [1, 2, 3, 4],
    );
    assert.equal(
      PERFORMANCE_SECTIONS.find((s) => s.code === 'basic')?.maxScore,
      14,
    );
    assert.equal(
      PERFORMANCE_SECTIONS.find((s) => s.code === 'performance')?.maxScore,
      44,
    );
  });

  it('二级维度归属正确章节', () => {
    const basic = subDimensionsForSection('basic');
    assert.equal(basic.length, 3);
    assert.ok(basic.every((d) => d.sectionCode === 'basic'));

    const perf = subDimensionsForSection('performance');
    assert.ok(perf.length >= 4);
    assert.ok(isSubDimensionInSection('worksite.ticket-execution', 'worksite'));
    assert.equal(isSubDimensionInSection('basic.skill-level', 'performance'), false);
  });

  it('维度树包含全部二级项', () => {
    const tree = buildPerformanceDimensionTree();
    const subCount = tree.reduce((n, s) => n + s.subDimensions.length, 0);
    assert.equal(subCount, PERFORMANCE_SUB_DIMENSIONS.length);
  });

  it('defaultSectionTitle 含满分', () => {
    assert.match(defaultSectionTitle('worksite', 2), /工作现场/);
    assert.match(defaultSectionTitle('worksite', 2), /42/);
  });
});
