/**
 * verify/dimension-checks 单测
 *
 * 用临时 xlsx 文件验证 check 函数的源数据解析与 DB 对比逻辑。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import {
  checkSkillLevel,
  checkTitleLevel,
  checkPerformanceLevel,
  summarize,
  type BasicFactRow,
} from './dimension-checks';

const tmpDir = mkdtempSync(join(tmpdir(), 'perf-verify-'));

before(() => {
  // 花名册（含技能等级、专业技术资格等级）
  const roster = [
    ['人员编号', '姓名', '技能等级', '专业技术资格等级'],
    ['001', '张三', '高级技师', '副高级'],
    ['002', '李四', '技师', '中级'],
    ['003', '王五', '', ''],  // 空值
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(roster);
  const wb1 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb1, ws1, '员工花名册');
  XLSX.writeFile(wb1, join(tmpDir, 'roster.xlsx'));

  // 人员考核结果（含 2023/2024/2025 三年等级）
  // 表头占 2 行：row 1 是 "人员考核结果"，row 2 是真实表头
  const evalAoa = [
    ['人员考核结果', '', '', '', '', '', '', '', '', '', '', ''],
    ['序号', '人员编码', '人员姓名', '岗位分类代码', '所在单位', '班组', '岗位', '人员类型', '是否考核', '2023年考核等级', '2024年考核等级', '2025年考核等级'],
    [1, '001', '张三', 'D-03', 'X', '', '班员', '班员', '是', 'A', 'A', 'A'],     // 3A → 6
    [2, '002', '李四', 'D-03', 'X', '', '班员', '班员', '是', 'B', 'B', 'B'],     // 3B → 4.5
    [3, '003', '王五', 'D-03', 'X', '', '班员', '班员', '是', 'A', 'B', 'C'],     // 含 C → 4
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(evalAoa);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, ws2, 'Sheet0');
  XLSX.writeFile(wb2, join(tmpDir, 'eval.xlsx'));
});

after(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('checkSkillLevel', () => {
  it('源数据 vs DB 完全匹配时 ok=true', () => {
    const dbFacts: BasicFactRow[] = [
      { employeeNo: '001', dimension: 'SKILL_LEVEL', tierValue: '高级技师', score: 4 },
      { employeeNo: '002', dimension: 'SKILL_LEVEL', tierValue: '技师', score: 3 },
      // 003 源空值，DB 也不计 mismatch
    ];
    const r = checkSkillLevel(dbFacts, join(tmpDir, 'roster.xlsx'));
    assert.equal(r.ok, true);
    assert.equal(r.mismatches.length, 0);
    assert.equal(r.expectedCount, 3);
    assert.equal(r.dbCount, 2);
  });

  it('DB 分数与源不符时报告 mismatch', () => {
    const dbFacts: BasicFactRow[] = [
      { employeeNo: '001', dimension: 'SKILL_LEVEL', tierValue: '高级技师', score: 3 }, // 应 4
      { employeeNo: '002', dimension: 'SKILL_LEVEL', tierValue: '技师', score: 3 },
    ];
    const r = checkSkillLevel(dbFacts, join(tmpDir, 'roster.xlsx'));
    assert.equal(r.ok, false);
    assert.equal(r.mismatches.length, 1);
    assert.equal(r.mismatches[0].employeeNo, '001');
    assert.equal(r.mismatches[0].expected, 4);
    assert.equal(r.mismatches[0].actual, 3);
  });
});

describe('checkTitleLevel', () => {
  it('副高级=4，中级=3，空=0', () => {
    const dbFacts: BasicFactRow[] = [
      { employeeNo: '001', dimension: 'TITLE_LEVEL', tierValue: '副高级', score: 4 },
      { employeeNo: '002', dimension: 'TITLE_LEVEL', tierValue: '中级', score: 3 },
    ];
    const r = checkTitleLevel(dbFacts, join(tmpDir, 'roster.xlsx'));
    assert.equal(r.ok, true);
  });
});

describe('checkPerformanceLevel', () => {
  it('3A=6, 3B=4.5, 含C=4', () => {
    const dbFacts: BasicFactRow[] = [
      { employeeNo: '001', dimension: 'PERFORMANCE_LEVEL', tierValue: '3A', score: 6 },
      { employeeNo: '002', dimension: 'PERFORMANCE_LEVEL', tierValue: '3B', score: 4.5 },
      { employeeNo: '003', dimension: 'PERFORMANCE_LEVEL', tierValue: '其他', score: 4 },
    ];
    const r = checkPerformanceLevel(dbFacts, join(tmpDir, 'eval.xlsx'));
    assert.equal(r.ok, true);
    assert.equal(r.expectedCount, 3);
  });

  it('**B5 回归**：全员=4 时所有非"其他"员工都 mismatch', () => {
    // 模拟 07-19 报表 bug：DB 中所有人都被错误记为 4
    const dbFacts: BasicFactRow[] = [
      { employeeNo: '001', dimension: 'PERFORMANCE_LEVEL', tierValue: '其他', score: 4 }, // 应 6
      { employeeNo: '002', dimension: 'PERFORMANCE_LEVEL', tierValue: '其他', score: 4 }, // 应 4.5
      { employeeNo: '003', dimension: 'PERFORMANCE_LEVEL', tierValue: '其他', score: 4 }, // 真应 4 ✓
    ];
    const r = checkPerformanceLevel(dbFacts, join(tmpDir, 'eval.xlsx'));
    assert.equal(r.ok, false);
    assert.equal(r.mismatches.length, 2); // 001 和 002 不匹配
  });
});

describe('summarize', () => {
  it('汇总各维度结果', () => {
    const r = summarize([
      { dimension: 'A', sourceLabel: 's', expectedCount: 1, dbCount: 1, mismatches: [], ok: true },
      { dimension: 'B', sourceLabel: 's', expectedCount: 1, dbCount: 1,
        mismatches: [{ employeeNo: '001', expected: 5, actual: 4 }], ok: false },
    ]);
    assert.equal(r.totalDimensions, 2);
    assert.equal(r.passed, 1);
    assert.equal(r.failed, 1);
    assert.equal(r.totalMismatches, 1);
  });
});
