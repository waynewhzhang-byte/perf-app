/**
 * 竞赛比武事实导入（performance.competition.competition / .exam）
 *
 * 规则（评分标准 对应表.xlsx 行 27-29）：
 *   技能竞赛类：代表省公司参加国网公司竞赛 10 分/次；代表公司参加省公司竞赛 5 分/次
 *   调考类：    参加国网公司调考 5 分/次；参加省公司调考 2 分/次
 *   知识竞赛类：入选国网公司竞赛名单 5 分/次；省公司名单 2 分/次
 *
 * 源数据 7.竞赛比武（4 人）：通过 "项目" 列（备注）判定类别。
 *
 * **规范**：写入必须经 replaceFactsBySource。
 */
import type { PrismaClient } from '@prisma/client';
import type { PerformanceFactSeed } from '@/lib/performance-fact-repository';
import { persistSeedsBySource, cellStr, type SeedBasedImportResult } from '@/lib/fact-import-common';

export type CompetitionKind = 'competition-skill' | 'competition-exam' | 'competition-knowledge';

export interface CompetitionScoreRule {
  kind: CompetitionKind;
  /** dimensionCode：技能/知识竞赛走 .competition，调考走 .exam */
  dimensionCode: 'performance.competition.competition' | 'performance.competition.exam';
  dimensionTitle: string;
  /** 国网级得分 / 省公司级得分 */
  scores: { guowang: number; sheng: number };
}

export const COMPETITION_RULES: Record<CompetitionKind, CompetitionScoreRule> = {
  'competition-skill': {
    kind: 'competition-skill',
    dimensionCode: 'performance.competition.competition',
    dimensionTitle: '技能竞赛',
    scores: { guowang: 10, sheng: 5 },
  },
  'competition-exam': {
    kind: 'competition-exam',
    dimensionCode: 'performance.competition.exam',
    dimensionTitle: '调考',
    scores: { guowang: 5, sheng: 2 },
  },
  'competition-knowledge': {
    kind: 'competition-knowledge',
    dimensionCode: 'performance.competition.competition',
    dimensionTitle: '知识竞赛',
    scores: { guowang: 5, sheng: 2 },
  },
};

export interface CompetitionFieldMapping {
  employeeNo: string;
  employeeName?: string;
  /** 奖项名称 */
  award: string;
  /** 级别（国网/省公司）—— 用于自动判分 */
  level: string;
  /** 类别（技能竞赛/调考/知识竞赛）—— 缺省时按 award 文本推断 */
  category?: string;
}

/** 根据奖项文本推断类别（无法判定时默认技能竞赛） */
export function inferCompetitionKind(award: string, category?: string): CompetitionKind {
  const text = `${category ?? ''} ${award}`.toLowerCase();
  if (/调考/.test(text)) return 'competition-exam';
  if (/知识竞赛/.test(text)) return 'competition-knowledge';
  return 'competition-skill';
}

/** 推断级别：国网 vs 省 */
export function inferLevel(level: string, award: string): 'guowang' | 'sheng' {
  const text = `${level} ${award}`;
  if (/国网|国家电网|全国/.test(text)) return 'guowang';
  return 'sheng';
}

export function buildCompetitionSeeds(
  rows: Record<string, string>[],
  mapping: CompetitionFieldMapping,
  year: number,
): PerformanceFactSeed[] {
  const seeds: PerformanceFactSeed[] = [];
  for (const row of rows) {
    const employeeNo = cellStr(row[mapping.employeeNo]);
    if (!employeeNo) continue;
    const employeeName = mapping.employeeName ? cellStr(row[mapping.employeeName]) : employeeNo;
    const award = cellStr(row[mapping.award]);
    const level = cellStr(row[mapping.level]);
    const category = mapping.category ? cellStr(row[mapping.category]) : undefined;

    const kind = inferCompetitionKind(award, category);
    const rule = COMPETITION_RULES[kind];
    const levelKey = inferLevel(level, award);
    const score = rule.scores[levelKey];

    seeds.push({
      year,
      employeeNo,
      employeeName,
      dimensionCode: rule.dimensionCode,
      dimensionTitle: rule.dimensionTitle,
      role: 'FIRST_HANDLER',
      eventType: 'REMEDIATION',
      score,
      defectRef: `competition:${award}:${employeeNo}`.slice(0, 200),
      defectLevel: '',
      eventDate: null,
      metadata: {
        award,
        level,
        category: category ?? null,
        kind,
        levelKey,
      },
    });
  }
  return seeds;
}

/** 导入竞赛比武事实。两个 dimensionCode 分别 batch-replace。 */
export async function importCompetitionFacts(
  prisma: PrismaClient,
  year: number,
  sourceFile: string,
  rows: Record<string, string>[],
  mapping: CompetitionFieldMapping,
): Promise<{ byDimension: Record<string, SeedBasedImportResult>; total: number }> {
  const seeds = buildCompetitionSeeds(rows, mapping, year);
  // 按维度分组
  const byDim = new Map<string, PerformanceFactSeed[]>();
  for (const seed of seeds) {
    const list = byDim.get(seed.dimensionCode) ?? [];
    list.push(seed);
    byDim.set(seed.dimensionCode, list);
  }
  const results: Record<string, SeedBasedImportResult> = {};
  let total = 0;
  for (const [dimCode, dimSeeds] of byDim) {
    const r = await persistSeedsBySource(prisma, { year, dimensionCode: dimCode, sourceFile }, dimSeeds);
    results[dimCode] = r;
    total += r.total;
  }
  return { byDimension: results, total };
}
