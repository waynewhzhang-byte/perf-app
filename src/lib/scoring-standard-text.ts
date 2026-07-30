/**
 * ScoringStandardText 的读写 seam（纯展示文案覆盖，不影响分数/算法/事实）。
 *
 * 业务背景：11 项计分规则的说明性文字默认来自编译期常量 SCORING_STANDARDS。
 * 管理员可通过后台按 (year, dimensionCode) 覆盖这些文字；未配置的字段回退常量。
 *
 * 与事实写入规范无关：本模块管理的只是「给员工看的规则说明字符串」，
 * maxScore / ruleType / 算法配置 / 事实数据 / 分数一律不在这里。
 *
 * 读取约定：null 列 = 该字段回退常量默认值（支持「只改一行说明」）；
 *           整行删除 = 完全回退默认。
 */
import type { PrismaClient, ScoringStandardText } from '@prisma/client';

/** 一条文案覆盖——所有字段均可空，null 表示该字段回退常量。 */
export interface ScoringStandardTextOverride {
  id?: string;
  title?: string | null;
  scoringSummary?: string | null;
  ownerDepartment?: string | null;
  referenceFile?: string | null;
  notes?: string | null;
}

export interface ScoringStandardTextUpsertInput {
  id?: string;
  year: number;
  dimensionCode: string;
  title?: string | null;
  scoringSummary?: string | null;
  ownerDepartment?: string | null;
  referenceFile?: string | null;
  notes?: string | null;
}

/**
 * 一次性加载某年度全部文案覆盖，按 dimensionCode 索引。
 * 无记录返回空 Map（调用方据此对 SCORING_STANDARDS 回退常量）。
 */
export async function loadScoringStandardOverrides(
  prisma: PrismaClient,
  year: number,
): Promise<Map<string, ScoringStandardTextOverride>> {
  const rows = await prisma.scoringStandardText.findMany({ where: { year } });
  const map = new Map<string, ScoringStandardTextOverride>();
  for (const row of rows) {
    map.set(row.dimensionCode, rowToOverride(row));
  }
  return map;
}

/** 按 (year, dimensionCode) upsert 一条文案覆盖。id 存在则更新，否则创建。 */
export async function upsertScoringStandardText(
  prisma: PrismaClient,
  input: ScoringStandardTextUpsertInput,
): Promise<ScoringStandardText> {
  const { year, dimensionCode, id, ...fields } = input;
  // null 显式保留（= 该字段回退常量）；undefined 视为「不改」。
  const data = {
    title: fields.title ?? null,
    scoringSummary: fields.scoringSummary ?? null,
    ownerDepartment: fields.ownerDepartment ?? null,
    referenceFile: fields.referenceFile ?? null,
    notes: fields.notes ?? null,
  };

  if (id) {
    return prisma.scoringStandardText.update({ where: { id }, data });
  }
  return prisma.scoringStandardText.upsert({
    where: { year_dimensionCode: { year, dimensionCode } },
    create: { year, dimensionCode, ...data },
    update: data,
  });
}

/** 删除一条覆盖（恢复该维度该年度为常量默认文案）。 */
export async function deleteScoringStandardText(
  prisma: PrismaClient,
  id: string,
): Promise<void> {
  await prisma.scoringStandardText.delete({ where: { id } });
}

function rowToOverride(row: ScoringStandardText): ScoringStandardTextOverride {
  return {
    id: row.id,
    title: row.title,
    scoringSummary: row.scoringSummary,
    ownerDepartment: row.ownerDepartment,
    referenceFile: row.referenceFile,
    notes: row.notes,
  };
}
