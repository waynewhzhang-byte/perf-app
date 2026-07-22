/**
 * 违章扣分事实导入（special.violation-severe / .general）
 *
 * 规则（评分标准 对应表.xlsx 行 67-71）：
 *   严重违章：直接责任人 -10 分/次；连带责任人 -5 分/次
 *   一般违章：直接责任人 -5 分/次；  连带责任人 -2.5 分/次
 *
 * 源数据 15.处罚人员名单：每行 1 人 1 次，含「等级」（严重/一般）+「人员类型」（直接/连带）。
 *
 * **规范**：写入必须经 replaceFactsBySource。分数为负数（扣分）。
 */
import type { PrismaClient } from '@prisma/client';
import type { PerformanceFactSeed } from '@/lib/performance-fact-repository';
import { persistSeedsByDimension, cellStr, type SeedBasedImportResult } from '@/lib/fact-import-common';

export type ViolationLevel = 'severe' | 'general';
export type ViolationRole = 'direct' | 'joint';

/** 矩阵：level × role → 扣分（负数） */
const VIOLATION_SCORES: Record<ViolationLevel, Record<ViolationRole, number>> = {
  severe: { direct: -10, joint: -5 },
  general: { direct: -5, joint: -2.5 },
};

/** dimensionCode 映射 */
const VIOLATION_DIMENSION: Record<ViolationLevel, { code: string; title: string }> = {
  severe: { code: 'special.violation-severe', title: '严重违章扣分' },
  general: { code: 'special.violation-general', title: '一般违章扣分' },
};

export interface ViolationFieldMapping {
  employeeNo: string;
  employeeName?: string;
  /** 违章等级（严重/一般；其他值视为 general） */
  level: string;
  /** 人员类型（直接责任人/连带责任人） */
  role: string;
  /** 违章描述/项目名 */
  description?: string;
  /** 事件日期 */
  eventDate?: string;
}

export function inferLevel(level: string): ViolationLevel {
  if (/严重/.test(level)) return 'severe';
  return 'general';
}

export function inferRole(role: string): ViolationRole {
  if (/连带/.test(role)) return 'joint';
  return 'direct';
}

export function buildViolationSeeds(
  rows: Record<string, string>[],
  mapping: ViolationFieldMapping,
  year: number,
): PerformanceFactSeed[] {
  const seeds: PerformanceFactSeed[] = [];
  for (const row of rows) {
    const employeeNo = cellStr(row[mapping.employeeNo]);
    if (!employeeNo) continue;
    const employeeName = mapping.employeeName ? cellStr(row[mapping.employeeName]) : employeeNo;
    const levelStr = cellStr(row[mapping.level]);
    const roleStr = cellStr(row[mapping.role]);
    const description = mapping.description ? cellStr(row[mapping.description]) : '';

    const level = inferLevel(levelStr);
    const role = inferRole(roleStr);
    const score = VIOLATION_SCORES[level][role];
    const dim = VIOLATION_DIMENSION[level];

    seeds.push({
      year,
      employeeNo,
      employeeName,
      dimensionCode: dim.code,
      dimensionTitle: dim.title,
      role: role === 'direct' ? 'FIRST_HANDLER' : 'CO_HANDLER',
      eventType: 'REMEDIATION',
      score,
      // defectRef 含描述+工号 避免多次违章被合并
      defectRef: `violation:${level}:${description || '未描述'}:${employeeNo}`.slice(0, 200),
      defectLevel: level === 'severe' ? '危急' : '一般',
      eventDate: mapping.eventDate ? cellStr(row[mapping.eventDate]) || null : null,
      metadata: {
        level,
        levelRaw: levelStr || null,
        role,
        roleRaw: roleStr || null,
        description: description || null,
      },
    });
  }
  return seeds;
}

/** 导入违章事实。两个 dimensionCode 分别 batch-replace。 */
export async function importViolationFacts(
  prisma: PrismaClient,
  year: number,
  sourceFile: string,
  rows: Record<string, string>[],
  mapping: ViolationFieldMapping,
): Promise<{ byDimension: Record<string, SeedBasedImportResult>; total: number }> {
  const seeds = buildViolationSeeds(rows, mapping, year);
  return persistSeedsByDimension(prisma, { year, sourceFile }, seeds);
}
