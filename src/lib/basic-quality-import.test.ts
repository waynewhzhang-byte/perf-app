import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  parseBasicQualityFile,
  buildBasicQualityFacts,
} from './basic-quality-import';
import {
  DEFAULT_SKILL_TIERS,
  DEFAULT_TITLE_TIERS,
  DEFAULT_PERFORMANCE_TIERS,
} from './basic-quality';

const XLSX = resolve(process.cwd(), '《基本素质信息_修改》.xlsx');
const tiers = {
  skill: DEFAULT_SKILL_TIERS,
  title: DEFAULT_TITLE_TIERS,
  performance: DEFAULT_PERFORMANCE_TIERS,
};

describe('parseBasicQualityFile', () => {
  it.skipIf(!existsSync(XLSX))('11401630：技师3 + 初级2 + 无考核4', () => {
    const parsed = parseBasicQualityFile(XLSX);
    const emp = parsed.employees.find((e) => e.employeeNo === '11401630');
    assert.ok(emp);
    assert.equal(emp!.skillLevel, '技师');
    assert.equal(emp!.titleLevel, '初级');

    const facts = buildBasicQualityFacts(emp!, parsed.assessments.get('11401630'), 2025, tiers);
    const byDim = Object.fromEntries(facts.map((f) => [f.dimension, f]));
    assert.equal(byDim.SKILL_LEVEL.score, 3);
    assert.equal(byDim.TITLE_LEVEL.score, 2);
    assert.equal(byDim.PERFORMANCE_LEVEL.score, 4);
  });

  it.skipIf(!existsSync(XLSX))('11425664：三年 3B → 4.5', () => {
    const parsed = parseBasicQualityFile(XLSX);
    const assess = parsed.assessments.get('11425664');
    assert.ok(assess);
    assert.deepEqual([assess!.year2023, assess!.year2024, assess!.year2025], ['B', 'B', 'B']);

    const emp = parsed.employees.find((e) => e.employeeNo === '11425664');
    assert.ok(emp);
    const perf = buildBasicQualityFacts(emp!, assess, 2025, tiers).find(
      (f) => f.dimension === 'PERFORMANCE_LEVEL',
    )!;
    assert.equal(perf.tierValue, '3B');
    assert.equal(perf.score, 4.5);
  });
});
