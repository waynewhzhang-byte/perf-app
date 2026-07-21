#!/usr/bin/env npx tsx
/**
 * 导入分数校验脚本（CI/手工回归用）。
 *
 * 读源 XLSX 重算期望分数 → 与 DB 事实对比 → 输出差异报告。
 * 退出码 0 = 全部匹配；1 = 有差异。
 *
 * 用法：
 *   pnpm verify:imported-scores
 *   npx tsx scripts/verify-imported-scores.ts [--data-dir <path>] [--year 2026]
 *
 * 覆盖维度（按修复优先级）：
 *   1. 基本素质三维度（SKILL / TITLE / PERFORMANCE_LEVEL）
 *   2. 后续可扩展：安全贡献 / 缺陷治理 / 两票 / 技术贡献 / 竞赛 / 创新 / 专利 / 违章
 *
 * 第一版只覆盖基本素质三维度（最易回归，且 07-19 报表 bug 正发生在此）。
 * 其他维度的 check 函数已就位但需要更多 DB 查询参数，留给后续 PR 扩展。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { prisma } from '../src/lib/prisma';
import {
  checkSkillLevel,
  checkTitleLevel,
  checkPerformanceLevel,
  summarize,
  type BasicFactRow,
} from '../src/lib/verify/dimension-checks';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const year = Number(argValue('--year', '2026'));
  const dataDir = argValue('--data-dir', '20260716超高压人员信息表');
  const rosterPath = resolve(dataDir, '1.能级评价员工花名册（435人 含职称 技能等级）.xlsx');
  const evalPath = resolve(dataDir, '2.人员考核结果（435人）.xlsx');

  console.log(`=== 校验 ${year} 年度导入分数 ===`);
  console.log(`数据目录: ${dataDir}\n`);

  // 读 DB 全部基本素质事实
  const dbRaw = await prisma.employeeBasicFact.findMany({
    where: { year },
    select: { employeeNo: true, dimension: true, tierValue: true, score: true },
  });
  const dbFacts: BasicFactRow[] = dbRaw.map((f) => ({
    employeeNo: f.employeeNo,
    dimension: f.dimension,
    tierValue: f.tierValue,
    score: Number(f.score),
  }));

  // 跑三维度 check
  const results = [
    checkSkillLevel(dbFacts, rosterPath),
    checkTitleLevel(dbFacts, rosterPath),
    checkPerformanceLevel(dbFacts, evalPath),
  ];

  // 打印每个维度结果
  for (const r of results) {
    const status = r.ok ? '✓' : '✗';
    console.log(`${status} ${r.dimension}: 源 ${r.expectedCount} / DB ${r.dbCount} / 不匹配 ${r.mismatches.length}`);
    if (!r.ok) {
      console.log(`   前 10 个不匹配:`);
      for (const m of r.mismatches.slice(0, 10)) {
        console.log(`     ${m.employeeNo} ${m.employeeName ?? ''}: 期望 ${m.expected} / 实际 ${m.actual}${m.detail ? ` (${m.detail})` : ''}`);
      }
      if (r.mismatches.length > 10) console.log(`     ... 共 ${r.mismatches.length} 个`);
    }
  }

  // 汇总
  const summary = summarize(results);
  console.log(`\n=== 汇总 ===`);
  console.log(`维度: ${summary.passed}/${summary.totalDimensions} 通过`);
  console.log(`不匹配总数: ${summary.totalMismatches}`);

  // 写 JSON 报告
  const reportPath = resolve('data/generated', `verify-report-${year}-${Date.now()}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`详细报告: ${reportPath}`);

  // 退出码：有差异则 1
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
