/**
 * 事实导入共用工具：把 PerformanceFactSeed[] 写入 DB 的薄 wrapper。
 *
 * 5 个新维度导入器（tech-contrib / competition / innovation / patent / violation）
 * 共用同一套写入语义：buildXxxSeeds() 纯函数计分 + 一次性查 userId + replaceFactsBySource。
 * 不走 manual-fact-import.ts 的 computeFactScores，因为这些维度无 ScoringRule DB 配置
 * （ruleType 是 MANUAL_TIERS / MANUAL_COUNTED，规则在 lib 模块里硬编码并与
 * scoring-standards.ts 保持一致）。
 *
 * **规范**：所有 PerformanceFact 业务写入必须经 replaceFactsBySource（见
 * docs/agents/fact-import-conventions.md）。
 */
import type { PrismaClient } from '@prisma/client';
import {
  replaceFactsBySource,
  type PerformanceFactSeed,
  type ReplaceFactsResult,
} from '@/lib/performance-fact-repository';
import { loadUserIdByEmployeeNo } from '@/lib/fact-import-persistence';

export interface SeedBasedImportResult {
  total: number;
  created: number;
  /** batch-replace 语义下永远为 0 */
  updated: number;
  skipped: number;
  /** scope 下被 deleteMany 清掉的旧事实条数 */
  deleted: number;
}

/**
 * 按 (year, dimensionCode, sourceFile) batch-replace 写入 seeds。
 *
 * 调用方负责：① 工号有效（无效行 buildXxxSeeds 应过滤掉）；② 计分规则正确；
 * ③ defectRef 唯一性（避免同一员工不同项被 dedupeSeeds 合并）。
 */
export async function persistSeedsBySource(
  prisma: PrismaClient,
  scope: { year: number; dimensionCode: string; sourceFile: string },
  seeds: PerformanceFactSeed[],
): Promise<SeedBasedImportResult> {
  if (seeds.length === 0) {
    // 空输入仍按 batch-replace 语义清空该 scope
    const result = await replaceFactsBySource(prisma, scope, [], new Map());
    return { total: 0, created: 0, updated: 0, skipped: 0, deleted: result.deleted };
  }

  const employeeNos = [...new Set(seeds.map((s) => s.employeeNo))];
  const userIdByNo = await loadUserIdByEmployeeNo(prisma, employeeNos);

  // 工号未匹配 userId 的行视为 skipped（保留 seed 但 userId=null，replaceFactsBySource 已支持）
  const result: ReplaceFactsResult = await replaceFactsBySource(
    prisma,
    scope,
    seeds,
    userIdByNo,
  );

  return {
    total: seeds.length,
    created: result.created,
    updated: 0,
    skipped: 0,
    deleted: result.deleted,
  };
}

/** 规范化单元格值为字符串；空值返回 '' */
export function cellStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}
