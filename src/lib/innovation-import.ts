/**
 * 创新奖项事实导入（performance.innovation.award）
 *
 * 规则（评分标准 对应表.xlsx 行 30-34）：
 *   管理/科技创新：国网公司级 5 分/次；省公司级 3 分/次
 *   QC/五小：     国网公司级 4 分/次；省公司级 2 分/次
 *
 * 源数据 8.创新奖项人员总汇（34 人）：通过 "奖项" + "级别" 列自动判定。
 *
 * **规范**：写入必须经 replaceFactsBySource。
 */
import type { PrismaClient } from '@prisma/client';
import type { PerformanceFactSeed } from '@/lib/performance-fact-repository';
import { persistSeedsBySource, cellStr, type SeedBasedImportResult } from '@/lib/fact-import-common';

export type InnovationCategory = 'management-tech' | 'qc-wuxiao';

export interface InnovationScoreRule {
  category: InnovationCategory;
  scores: { guowang: number; sheng: number };
}

export const INNOVATION_RULES: Record<InnovationCategory, InnovationScoreRule> = {
  'management-tech': {
    category: 'management-tech',
    scores: { guowang: 5, sheng: 3 },
  },
  'qc-wuxiao': {
    category: 'qc-wuxiao',
    scores: { guowang: 4, sheng: 2 },
  },
};

export interface InnovationFieldMapping {
  employeeNo: string;
  employeeName?: string;
  /** 奖项名称 —— 用于判定 QC/五小 vs 管理/科技 */
  award: string;
  /** 级别（国网/省公司）—— 用于判定得分 */
  level: string;
  /** 项目名（可选，用于 defectRef 唯一性） */
  project?: string;
}

/** 根据奖项文本推断类别（QC/五小 vs 管理/科技） */
export function inferInnovationCategory(award: string): InnovationCategory {
  if (/QC|五小/.test(award)) return 'qc-wuxiao';
  return 'management-tech';
}

export function inferInnovationLevel(level: string, award: string): 'guowang' | 'sheng' {
  const text = `${level} ${award}`;
  if (/国网|国家电网|全国/.test(text)) return 'guowang';
  return 'sheng';
}

export function buildInnovationSeeds(
  rows: Record<string, string>[],
  mapping: InnovationFieldMapping,
  year: number,
): PerformanceFactSeed[] {
  const seeds: PerformanceFactSeed[] = [];
  for (const row of rows) {
    const employeeNo = cellStr(row[mapping.employeeNo]);
    if (!employeeNo) continue;
    const employeeName = mapping.employeeName ? cellStr(row[mapping.employeeName]) : employeeNo;
    const award = cellStr(row[mapping.award]);
    const level = cellStr(row[mapping.level]);
    const project = mapping.project ? cellStr(row[mapping.project]) : '';

    const category = inferInnovationCategory(award);
    const rule = INNOVATION_RULES[category];
    const levelKey = inferInnovationLevel(level, award);
    const score = rule.scores[levelKey];

    // defectRef 必须包含 award（+ project 若有），避免同员工不同奖项被合并
    const refKey = project ? `${award}:${project}:${employeeNo}` : `${award}:${employeeNo}`;
    seeds.push({
      year,
      employeeNo,
      employeeName,
      dimensionCode: 'performance.innovation.award',
      dimensionTitle: '创新奖项',
      role: 'FIRST_HANDLER',
      eventType: 'REMEDIATION',
      score,
      defectRef: `innovation:${refKey}`.slice(0, 200),
      defectLevel: '',
      eventDate: null,
      metadata: {
        award,
        level,
        project: project || null,
        category,
        levelKey,
      },
    });
  }
  return seeds;
}

export async function importInnovationFacts(
  prisma: PrismaClient,
  year: number,
  sourceFile: string,
  rows: Record<string, string>[],
  mapping: InnovationFieldMapping,
): Promise<SeedBasedImportResult> {
  const seeds = buildInnovationSeeds(rows, mapping, year);
  return persistSeedsBySource(
    prisma,
    { year, dimensionCode: 'performance.innovation.award', sourceFile },
    seeds,
  );
}
