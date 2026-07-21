/**
 * 各维度源数据 vs DB 事实的核对逻辑。
 *
 * 每个 check 函数：
 *   - 输入：DB 事实聚合（从外部传入，避免重复查询）+ 源 XLSX 路径
 *   - 输出：{ dimension, expectedCount, dbCount, mismatches, ok }
 *
 * 用于 scripts/verify-imported-scores.ts。所有 check 都是纯函数，便于单测。
 */
import { loadSheet, loadMatrix, type SourceSheet } from './source-loader';
import { scoreSkillLevel, scoreTitleLevel, scorePerformanceLevel } from '@/lib/basic-quality';

export interface Mismatch {
  employeeNo: string;
  employeeName?: string;
  expected: number;
  actual: number;
  detail?: string;
}

export interface DimensionCheckResult {
  dimension: string;
  sourceLabel: string;
  expectedCount: number;
  dbCount: number;
  mismatches: Mismatch[];
  ok: boolean;
}

// ── 基本素质三维度 ────────────────────────────────────────────────

export interface BasicFactRow {
  employeeNo: string;
  dimension: string;
  tierValue: string;
  score: number;
}

export function checkSkillLevel(
  dbFacts: BasicFactRow[],
  rosterPath: string,
): DimensionCheckResult {
  const matrix = loadMatrix(rosterPath);
  const header = matrix[0] ?? [];
  // 找列：技能等级 在第 31 列（0-indexed）
  const enoCol = header.indexOf('人员编号');
  const nameCol = header.indexOf('姓名');
  const skillCol = header.indexOf('技能等级');
  const expected = new Map<string, { name: string; tier: string; score: number }>();
  for (let i = 1; i < matrix.length; i += 1) {
    const eno = matrix[i]?.[enoCol]?.trim();
    if (!eno) continue;
    const tier = matrix[i]?.[skillCol]?.trim() ?? '';
    expected.set(eno, {
      name: matrix[i]?.[nameCol]?.trim() ?? eno,
      tier,
      score: scoreSkillLevel(tier),
    });
  }
  return compareBasicDimension('SKILL_LEVEL', '技能等级', dbFacts, expected, rosterPath);
}

export function checkTitleLevel(
  dbFacts: BasicFactRow[],
  rosterPath: string,
): DimensionCheckResult {
  const matrix = loadMatrix(rosterPath);
  const header = matrix[0] ?? [];
  const enoCol = header.indexOf('人员编号');
  const nameCol = header.indexOf('姓名');
  const titleCol = header.indexOf('专业技术资格等级');
  const expected = new Map<string, { name: string; tier: string; score: number }>();
  for (let i = 1; i < matrix.length; i += 1) {
    const eno = matrix[i]?.[enoCol]?.trim();
    if (!eno) continue;
    const tier = matrix[i]?.[titleCol]?.trim() ?? '';
    // 与 DB 一致：用 scoreTitleLevel（按等级：副高级=4、中级=3、初级=2）
    const score = scoreTitleLevel(tier);
    expected.set(eno, {
      name: matrix[i]?.[nameCol]?.trim() ?? eno,
      tier,
      score,
    });
  }
  return compareBasicDimension('TITLE_LEVEL', '职称等级', dbFacts, expected, rosterPath);
}

export function checkPerformanceLevel(
  dbFacts: BasicFactRow[],
  evalPath: string,
): DimensionCheckResult {
  const matrix = loadMatrix(evalPath);
  // 真实表头在 row 2（index 1），数据从 row 3 起
  // 序号=0, 人员编码=1, 姓名=2, ..., 2023=9, 2024=10, 2025=11
  const expected = new Map<string, { name: string; tier: string; score: number }>();
  for (let i = 2; i < matrix.length; i += 1) {
    const eno = matrix[i]?.[1]?.trim();
    if (!eno) continue;
    const name = matrix[i]?.[2]?.trim() ?? eno;
    const grades = [matrix[i]?.[9] ?? '', matrix[i]?.[10] ?? '', matrix[i]?.[11] ?? ''];
    const result = scorePerformanceLevel(grades);
    expected.set(eno, { name, tier: result.code, score: result.score });
  }
  return compareBasicDimension('PERFORMANCE_LEVEL', '绩效等级', dbFacts, expected, evalPath);
}

function compareBasicDimension(
  dimension: string,
  label: string,
  dbFacts: BasicFactRow[],
  expected: Map<string, { name: string; tier: string; score: number }>,
  sourceLabel: string,
): DimensionCheckResult {
  const dbByNo = new Map<string, BasicFactRow>();
  for (const f of dbFacts) {
    if (f.dimension === dimension) dbByNo.set(f.employeeNo, f);
  }
  const mismatches: Mismatch[] = [];
  for (const [eno, exp] of expected) {
    const db = dbByNo.get(eno);
    if (!db) continue; // 缺失不计入 mismatch（源数据空值跳过导入是正常的）
    if (Math.abs(db.score - exp.score) > 0.01) {
      mismatches.push({
        employeeNo: eno,
        employeeName: exp.name,
        expected: exp.score,
        actual: db.score,
        detail: `tier: 源=${exp.tier || '(空)'} db=${db.tierValue}`,
      });
    }
  }
  return {
    dimension: `${dimension} (${label})`,
    sourceLabel,
    expectedCount: expected.size,
    dbCount: dbByNo.size,
    mismatches: mismatches.sort((a, b) => Math.abs(b.expected - b.actual) - Math.abs(a.expected - a.actual)),
    ok: mismatches.length === 0,
  };
}

// ── 通用：DB 事实聚合工具 ────────────────────────────────────────

export interface PerformanceFactRow {
  employeeNo: string;
  employeeName: string;
  dimensionCode: string;
  score: number;
  defectRef: string;
}

/** 把 PerformanceFact[] 按 dimensionCode 分组并求和 */
export function sumByEmployee(
  facts: PerformanceFactRow[],
  dimensionCode: string,
): Map<string, { name: string; total: number; count: number }> {
  const out = new Map<string, { name: string; total: number; count: number }>();
  for (const f of facts) {
    if (f.dimensionCode !== dimensionCode) continue;
    const cur = out.get(f.employeeNo) ?? { name: f.employeeName, total: 0, count: 0 };
    cur.total += f.score;
    cur.count += 1;
    out.set(f.employeeNo, cur);
  }
  return out;
}

// ── 简单汇总（用于脚本最终报告） ────────────────────────────────

export interface VerifySummary {
  totalDimensions: number;
  passed: number;
  failed: number;
  totalMismatches: number;
  results: DimensionCheckResult[];
}

export function summarize(results: DimensionCheckResult[]): VerifySummary {
  const passed = results.filter((r) => r.ok).length;
  return {
    totalDimensions: results.length,
    passed,
    failed: results.length - passed,
    totalMismatches: results.reduce((n, r) => n + r.mismatches.length, 0),
    results,
  };
}
