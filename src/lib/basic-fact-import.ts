/**
 * 基本素质三维度导入（技能/职称/绩效）。
 *
 * 一次上传 → 每行三条 EmployeeBasicFact。
 * 计分复用 basic-quality.ts 的 scoreSkillLevel/scoreTitleLevel/scorePerformanceLevel。
 */
import type { BasicDimension } from '@prisma/client';
import {
  scoreSkillLevel,
  scoreTitleLevel,
  scorePerformanceLevel,
  DEFAULT_SKILL_TIERS,
  DEFAULT_TITLE_TIERS,
  DEFAULT_PERFORMANCE_TIERS,
} from './basic-quality';

export interface BasicFactFieldMapping {
  employeeNo: string;
  fullName: string;
  skill: string;
  title: string;
  perf2023: string;
  perf2024: string;
  perf2025: string;
}

/** 三维度档位表（来自 ScoringRule.config.tiers，缺则回退默认） */
export interface BasicFactTiers {
  skill?: Record<string, number>;
  title?: Record<string, number>;
  performance?: Record<string, number>;
}

export interface BasicFactDraft {
  employeeNo: string;
  employeeName: string;
  dimension: BasicDimension;
  tierValue: string;
  yearBreakdown: Record<string, string | null> | null;
  score: number;
}

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/** 三年等级规范化为 'A'/'B'/null（C 与空 → null） */
function normGrade(v: unknown): string | null {
  const s = norm(v).toUpperCase();
  return s === 'A' || s === 'B' ? s : null;
}

/**
 * 由映射 + 行 → 三条事实草稿（技能/职称/绩效）。
 * 工号缺失跳过。绩效按三年 A/B 组合计分。
 *
 * @param evalYear 评价年度（草稿阶段仅记录，DB 写入在 importBasicFacts 中使用）
 */
export function buildBasicFactDrafts(
  mapping: BasicFactFieldMapping,
  rows: Record<string, string>[],
  evalYear: number,
  tiers: BasicFactTiers = {},
): BasicFactDraft[] {
  const skillTiers = tiers.skill ?? DEFAULT_SKILL_TIERS;
  const titleTiers = tiers.title ?? DEFAULT_TITLE_TIERS;
  const perfTiers = tiers.performance ?? DEFAULT_PERFORMANCE_TIERS;
  const drafts: BasicFactDraft[] = [];

  for (const row of rows) {
    const employeeNo = norm(row[mapping.employeeNo]);
    if (!employeeNo) continue;
    const employeeName = norm(row[mapping.fullName]);

    const skillLevel = norm(row[mapping.skill]);
    drafts.push({
      employeeNo, employeeName,
      dimension: 'SKILL_LEVEL',
      tierValue: skillLevel || '其他',
      yearBreakdown: null,
      score: scoreSkillLevel(skillLevel, skillTiers),
    });

    const titleLevel = norm(row[mapping.title]);
    drafts.push({
      employeeNo, employeeName,
      dimension: 'TITLE_LEVEL',
      tierValue: titleLevel || '无',
      yearBreakdown: null,
      score: scoreTitleLevel(titleLevel, titleTiers),
    });

    const g2023 = normGrade(row[mapping.perf2023]);
    const g2024 = normGrade(row[mapping.perf2024]);
    const g2025 = normGrade(row[mapping.perf2025]);
    const perf = scorePerformanceLevel([g2023, g2024, g2025], perfTiers);
    drafts.push({
      employeeNo, employeeName,
      dimension: 'PERFORMANCE_LEVEL',
      tierValue: perf.code,
      yearBreakdown: { '2023': g2023, '2024': g2024, '2025': g2025 },
      score: perf.score,
    });
  }

  void evalYear;
  return drafts;
}

import type { PrismaClient, BasicDimension } from '@prisma/client';
import {
  replaceBasicFactsBySource,
  type BasicFactSeed,
} from '@/lib/basic-fact-repository';
import { loadUserIdByEmployeeNo } from '@/lib/fact-import-persistence';

/** 从 DB 读三维度 tiers（无配置回退默认） */
export async function loadBasicFactTiers(prisma: PrismaClient): Promise<BasicFactTiers> {
  const read = async (code: string, fallback: Record<string, number>) => {
    const row = await prisma.scoringRule.findUnique({ where: { dimensionCode: code } });
    const cfg = (row?.config ?? {}) as { tiers?: Record<string, number> };
    return cfg.tiers ?? fallback;
  };
  const [skill, title, performance] = await Promise.all([
    read('basic.skill-level', DEFAULT_SKILL_TIERS),
    read('basic.title-level', DEFAULT_TITLE_TIERS),
    read('basic.performance-level', DEFAULT_PERFORMANCE_TIERS),
  ]);
  return { skill, title, performance };
}

export interface BasicFactImportResult {
  /** 涉及的员工数（去重工号） */
  total: number;
  created: number;
  /** batch-replace 语义下永远为 0 —— 重新上传等同整体替换 */
  updated: number;
  /** 该 scope 下被 deleteMany 清掉的旧事实条数 */
  deleted: number;
}

/** 把 BasicFactDraft 转为 BasicFactSeed（中立形态） */
function toSeed(draft: BasicFactDraft, year: number): BasicFactSeed {
  return {
    year,
    employeeNo: draft.employeeNo,
    employeeName: draft.employeeName,
    dimension: draft.dimension,
    tierValue: draft.tierValue,
    yearBreakdown: draft.yearBreakdown,
    score: draft.score,
  };
}

/**
 * 导入基本素质三维度：读 tiers → 草稿 → 按 dimension 分组 → 一次性查 userId →
 * 对每个 dimension 调 replaceBasicFactsBySource（batch-replace）。
 *
 * 写入语义：按 (year, dimension, sourceFile) 整体替换。重新上传同一份文件，
 * 文件中不再出现的旧档位值视为已被清洗，删除。与 PerformanceFact 的
 * replaceFactsBySource 语义对称。
 *
 * **规范**：所有 EmployeeBasicFact 业务写入必须经 replaceBasicFactsBySource
 * （见 docs/agents/fact-import-conventions.md）。
 */
export async function importBasicFacts(
  prisma: PrismaClient,
  mapping: BasicFactFieldMapping,
  rows: Record<string, string>[],
  evalYear: number,
  sourceFile: string,
): Promise<BasicFactImportResult> {
  const tiers = await loadBasicFactTiers(prisma);
  const drafts = buildBasicFactDrafts(mapping, rows, evalYear, tiers);

  // 涉及员工数
  const employeeNos = [...new Set(drafts.map((d) => d.employeeNo))];
  if (employeeNos.length === 0) {
    return { total: 0, created: 0, updated: 0, deleted: 0 };
  }

  // 一次性批量查 userId，避免逐行 findFirst 的 N+1
  const userIdByNo = await loadUserIdByEmployeeNo(prisma, employeeNos);

  // 按 dimension 分组（3 组）
  const byDim = new Map<BasicDimension, BasicFactSeed[]>();
  for (const draft of drafts) {
    const list = byDim.get(draft.dimension) ?? [];
    list.push(toSeed(draft, evalYear));
    byDim.set(draft.dimension, list);
  }

  // 对每个 dimension 调 batch-replace（3 个独立 scope，互不影响）
  let created = 0;
  let deleted = 0;
  for (const [dimension, seeds] of byDim) {
    const result = await replaceBasicFactsBySource(
      prisma,
      { year: evalYear, dimension, sourceFile },
      seeds,
      userIdByNo,
    );
    created += result.created;
    deleted += result.deleted;
  }

  return { total: employeeNos.length, created, updated: 0, deleted };
}
