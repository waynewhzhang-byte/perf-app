#!/usr/bin/env npx tsx
/**
 * 从《人员考核结果（435人）》.xlsx 恢复 2026 年绩效等级事实。
 *
 * **本脚本是 src/lib/restore-2026/performance-level.ts 的薄壳**。
 * 真正的解析与写入逻辑在 lib 中，遵循事实写入规范（replaceBasicFactsBySource）。
 *
 * 历史背景：2026-07-19 生成报表时 PERFORMANCE_LEVEL 表为空（导入时序遗漏），
 * 导致全员绩效=4 分；2026-07-20 用本脚本补导入后修复。
 *
 * 用法：npx tsx scripts/restore-2026-performance-facts.ts [--year 2026] [--source <path>]
 */
import { prisma } from '../src/lib/prisma';
import { restorePerformanceLevel } from '../src/lib/restore-2026/performance-level';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const year = Number(argValue('--year', '2026'));
  const sourceFile = argValue('--source', '20260716超高压人员信息表/2.人员考核结果（435人）.xlsx');
  console.log(`恢复 ${year} 年绩效等级事实：${sourceFile}`);
  const result = await restorePerformanceLevel(prisma, { year, sourceFile });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
