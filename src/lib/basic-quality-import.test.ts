/**
 * @deprecated 本测试对应的 src/lib/basic-quality-import.ts 已废弃
 * （生产路径已迁移到 basic-fact-import.ts + replaceBasicFactsBySource）。
 * 测试整体跳过避免误导；如需验证基本素质导入，请看 basic-fact-import.test.ts。
 * 后续 PR 会随 basic-quality-import.ts 一并清理。
 */
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

describe('parseBasicQualityFile', { skip: 'basic-quality-import.ts 已废弃，测试整体跳过' }, () => {
  it('11401630：技师3 + 初级2 + 无考核4', { skip: !existsSync(XLSX) }, () => {
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

  it('11425664：三年 3B → 4.5', { skip: !existsSync(XLSX) }, () => {
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
