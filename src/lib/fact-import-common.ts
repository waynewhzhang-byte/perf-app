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
 *
 * @param scope.replaceAcrossSourceFiles  若 true，先 deleteMany 整个 (year, dimensionCode)
 *   再写入（无视 sourceFile）。用于一次性重导场景，确保旧的 buggy sourceFile 数据
 *   也被清除。生产 UI 导入不要传此参数（保留多 sourceFile 并存语义）。
 */
export async function persistSeedsBySource(
  prisma: PrismaClient,
  scope: {
    year: number;
    dimensionCode: string;
    sourceFile: string;
    replaceAcrossSourceFiles?: boolean;
    preserveEmployeeScoreTotals?: boolean;
    createdBy?: string;
  },
  seeds: PerformanceFactSeed[],
): Promise<SeedBasedImportResult> {
  if (seeds.length === 0) {
    // 空输入仍按 batch-replace 语义清空该 scope
    const result = await replaceFactsBySource(
      prisma,
      { ...scope, refreshSubmissions: !scope.replaceAcrossSourceFiles },
      [],
      new Map(),
    );
    return { total: 0, created: 0, updated: 0, skipped: 0, deleted: result.deleted };
  }

  const employeeNos = [...new Set(seeds.map((s) => s.employeeNo))];
  const userIdByNo = await loadUserIdByEmployeeNo(prisma, employeeNos);

  // replaceAcrossSourceFiles 模式：先按 (year, dimensionCode) 清空所有旧记录
  // （无视 sourceFile），用于一次性重导清除旧 buggy sourceFile 数据。
  // 工号未匹配 userId 的行保留为 userId=null，replaceFactsBySource 已支持。
  const result: ReplaceFactsResult = await replaceFactsBySource(
    prisma,
    { ...scope, refreshSubmissions: !scope.replaceAcrossSourceFiles },
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

/** 按维度分组并按插入顺序分别 batch-replace。 */
export async function persistSeedsByDimension(
  prisma: PrismaClient,
  scope: { year: number; sourceFile: string },
  seeds: PerformanceFactSeed[],
): Promise<{ byDimension: Record<string, SeedBasedImportResult>; total: number }> {
  const byDimension = new Map<string, PerformanceFactSeed[]>();
  for (const seed of seeds) {
    const dimensionSeeds = byDimension.get(seed.dimensionCode) ?? [];
    dimensionSeeds.push(seed);
    byDimension.set(seed.dimensionCode, dimensionSeeds);
  }

  const results: Record<string, SeedBasedImportResult> = {};
  let total = 0;
  for (const [dimensionCode, dimensionSeeds] of byDimension) {
    const result = await persistSeedsBySource(
      prisma,
      { ...scope, dimensionCode },
      dimensionSeeds,
    );
    results[dimensionCode] = result;
    total += result.total;
  }
  return { byDimension: results, total };
}

/** 规范化单元格值为字符串；空值返回 '' */
export function cellStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/** 读取导入准备阶段标注的真实 Excel 行号；普通上传仍按“首行为表头”回退。 */
export function sourceRowNoOf(row: Record<string, string>, fallback: number): number {
  const sourceRowNo = Number(row.__sourceRowNo);
  return Number.isInteger(sourceRowNo) && sourceRowNo > 0 ? sourceRowNo : fallback;
}
