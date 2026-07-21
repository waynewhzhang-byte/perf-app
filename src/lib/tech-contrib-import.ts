/**
 * 技术贡献事实导入（performance.technical-contribution.*）
 *
 * 三个子维度：
 *   - textbook（教材/题库/课件开发）：3 分/次
 *   - regulation（运规编写/会审）：2 分/项
 *   - ticket-revision（两票修订/审查）：2 分/项
 * 父维度 cap = 12（在 performance-score-sheet 聚合时封顶）。
 *
 * 规则（量化积分表讨论稿第四稿 + 评分标准 对应表）：
 *   1. 制定国标/行标 4 分、地/企标 3 分 —— 暂未实现（业务方确认 Q3）
 *   2. 参加公司级及以上教材编制、题库开发、课件开发 → 3 分/次
 *   3. 编制公司级及以上《运规》《典操》《两票》《应急预案》→ 2 分/项
 *      （《典操》《应急预案》暂无源数据；运规 + 两票修订 有源数据）
 *
 * **B1 修复**：源数据（《运规》编写会审人员）使用合并单元格表达
 * "同一规程/地域下多人"，必须在 parse.ts 的 expandMergedCells 处理后再读。
 * 本模块假定 rows 已是展开后的形态——每行有完整的规程名/地域/人员。
 *
 * **规范**：写入必须经 replaceFactsBySource（本模块已遵守）。
 */
import type { PrismaClient } from '@prisma/client';
import type { PerformanceFactSeed } from '@/lib/performance-fact-repository';
import { persistSeedsBySource, cellStr, type SeedBasedImportResult } from '@/lib/fact-import-common';

/** 三类技术贡献子维度配置 */
export interface TechContribKind {
  /** PerformanceFact.dimensionCode */
  dimensionCode: 'performance.technical-contribution.textbook'
    | 'performance.technical-contribution.regulation'
    | 'performance.technical-contribution.ticket-revision';
  dimensionTitle: string;
  /** 单项得分（教材 3 / 运规 2 / 两票修订 2） */
  unitScore: number;
}

export const TECH_CONTRIB_KINDS: Record<string, TechContribKind> = {
  textbook: {
    dimensionCode: 'performance.technical-contribution.textbook',
    dimensionTitle: '技术贡献（教材/题库/课件）',
    unitScore: 3,
  },
  regulation: {
    dimensionCode: 'performance.technical-contribution.regulation',
    dimensionTitle: '技术贡献（运规编写/会审）',
    unitScore: 2,
  },
  'ticket-revision': {
    dimensionCode: 'performance.technical-contribution.ticket-revision',
    dimensionTitle: '技术贡献（两票修订/审查）',
    unitScore: 2,
  },
};

/** 字段映射：工号 + 姓名 + 项目名（用于 defectRef 唯一性） */
export interface TechContribFieldMapping {
  employeeNo: string;
  employeeName?: string;
  /** 项目名（规程名/教材名/两票名）；缺省时用 '未命名' */
  projectName?: string;
  /** 角色（如 会审人员/编写人员/修订主要人员）；存入 metadata */
  role?: string;
}

/**
 * 把源数据行转为 PerformanceFactSeed[]。
 * 同一员工参与多个不同项目 → 多条 seed（每条 defectRef 含项目名以避免去重合并）。
 *
 * @param kind 三类之一
 * @param rows 已展开合并单元格的源数据行
 * @param mapping 字段映射
 * @param year 评价年度
 */
export function buildTechContribSeeds(
  kind: TechContribKind,
  rows: Record<string, string>[],
  mapping: TechContribFieldMapping,
  year: number,
): PerformanceFactSeed[] {
  const seeds: PerformanceFactSeed[] = [];
  for (const row of rows) {
    const employeeNo = cellStr(row[mapping.employeeNo]);
    if (!employeeNo) continue;
    const employeeName = mapping.employeeName ? cellStr(row[mapping.employeeName]) : employeeNo;
    const projectName = mapping.projectName ? cellStr(row[mapping.projectName]) : '';
    const role = mapping.role ? cellStr(row[mapping.role]) : '';
    // defectRef 包含项目名 + 工号，避免同一员工不同项目被 dedupeSeeds 合并（B1 根因）
    const defectRef = `tech:${kind.dimensionCode}:${projectName || '未命名'}:${employeeNo}`.slice(0, 200);
    seeds.push({
      year,
      employeeNo,
      employeeName,
      dimensionCode: kind.dimensionCode,
      dimensionTitle: kind.dimensionTitle,
      role: 'FIRST_HANDLER',
      eventType: 'REMEDIATION',
      score: kind.unitScore,
      defectRef,
      defectLevel: '',
      eventDate: null,
      metadata: {
        projectName: projectName || null,
        role: role || null,
      },
    });
  }
  return seeds;
}

/** 导入技术贡献事实（按子维度分别 batch-replace，3 个独立 sourceFile） */
export async function importTechContribFacts(
  prisma: PrismaClient,
  kindKey: keyof typeof TECH_CONTRIB_KINDS | string,
  year: number,
  sourceFile: string,
  rows: Record<string, string>[],
  mapping: TechContribFieldMapping,
): Promise<SeedBasedImportResult> {
  const kind = TECH_CONTRIB_KINDS[kindKey];
  if (!kind) throw new Error(`未知技术贡献类别: ${kindKey}`);
  const seeds = buildTechContribSeeds(kind, rows, mapping, year);
  return persistSeedsBySource(
    prisma,
    { year, dimensionCode: kind.dimensionCode, sourceFile },
    seeds,
  );
}
