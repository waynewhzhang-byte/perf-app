/**
 * 从《人员考核结果（435人）》.xlsx 恢复 2026 年绩效等级事实。
 *
 * 替代 scripts/restore-2026-performance-facts.ts（旧脚本直写 prisma.employeeBasicFact.upsert，
 * 违反事实写入规范）。本模块调 replaceBasicFactsBySource（batch-replace）。
 *
 * **规范**：禁止直写 prisma.employeeBasicFact；必须经 replaceBasicFactsBySource
 * （见 docs/agents/fact-import-conventions.md）。
 */
import * as XLSX from 'xlsx';
import type { PrismaClient } from '@prisma/client';
import { scorePerformanceLevel } from '@/lib/basic-quality';
import {
  replaceBasicFactsBySource,
  type BasicFactSeed,
} from '@/lib/basic-fact-repository';
import { loadUserIdByEmployeeNo } from '@/lib/fact-import-persistence';

const text = (value: unknown) => String(value ?? '').trim();

export interface RestorePerformanceLevelOptions {
  year: number;
  /** 源 XLSX 文件路径 */
  sourceFile: string;
  /** PerformanceFact.sourceFile 字段值（追溯用，默认 = sourceFile） */
  dbSourceFile?: string;
}

export interface RestorePerformanceLevelResult {
  parsed: number;
  created: number;
  deleted: number;
}

/**
 * 解析 XLSX → 计算 score → batch-replace 写入 PERFORMANCE_LEVEL 维度。
 *
 * 与 basic-fact-import.ts.importBasicFacts 的区别：
 * - 本函数只处理 PERFORMANCE_LEVEL 一维（专门用于补导/恢复场景）
 * - 直接读源 XLSX（不依赖前端字段映射）
 * - 评分逻辑复用 scorePerformanceLevel
 */
export async function restorePerformanceLevel(
  prisma: PrismaClient,
  options: RestorePerformanceLevelOptions,
): Promise<RestorePerformanceLevelResult> {
  const { year, sourceFile, dbSourceFile = sourceFile } = options;

  const workbook = XLSX.readFile(sourceFile, { raw: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet0!, { header: 1, defval: '' }) as unknown[][];
  const sourceRows = rows.slice(2)
    .map((row) => ({
      employeeNo: text((row as unknown[])[1]),
      employeeName: text((row as unknown[])[2]),
      grades: [text((row as unknown[])[9]), text((row as unknown[])[10]), text((row as unknown[])[11])],
    }))
    .filter((row) => row.employeeNo && row.employeeName);

  if (sourceRows.length === 0) {
    return { parsed: 0, created: 0, deleted: 0 };
  }

  const seeds: BasicFactSeed[] = sourceRows.map((row) => {
    const result = scorePerformanceLevel(row.grades);
    return {
      year,
      employeeNo: row.employeeNo,
      employeeName: row.employeeName,
      dimension: 'PERFORMANCE_LEVEL',
      tierValue: result.code,
      yearBreakdown: {
        '2023': row.grades[0] || null,
        '2024': row.grades[1] || null,
        '2025': row.grades[2] || null,
      },
      score: result.score,
    };
  });

  const employeeNos = [...new Set(seeds.map((s) => s.employeeNo))];
  const userIdByNo = await loadUserIdByEmployeeNo(prisma, employeeNos);

  const result = await replaceBasicFactsBySource(
    prisma,
    { year, dimension: 'PERFORMANCE_LEVEL', sourceFile: dbSourceFile },
    seeds,
    userIdByNo,
  );

  return { parsed: sourceRows.length, created: result.created, deleted: result.deleted };
}
