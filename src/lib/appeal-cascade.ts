/**
 * 员工申诉弹窗：按一级维度分组，落到《评分标准》二级评分项（固定 11 个）。
 * 不落到叶级事实行；「参加工作时间」不可申诉（只读展示并据此自动计算能级）。
 */
import {
  PERFORMANCE_SECTIONS,
  SCORING_STANDARDS,
  type PerformanceSectionCode,
} from '@/lib/scoring-standards';

/** 《评分标准》二级评分项，固定 11 个。 */
export const APPEAL_SCORING_POINT_CODES = SCORING_STANDARDS.map((s) => s.code);

const SCORING_POINT_ORDER = new Map<string, number>(
  APPEAL_SCORING_POINT_CODES.map((code, index) => [code, index]),
);

const SECTION_ORDER = new Map(
  PERFORMANCE_SECTIONS.map((section) => [section.code, section.excelOrder]),
);

export interface AppealCascadeItem {
  itemId: string;
  itemTitle: string;
  sectionTitle: string;
  sectionCode?: string | null;
  dimensionCode?: string | null;
  totalScore: number;
}

/** 可申诉维度：仅 11 个评分项点。 */
export function isAppealableDimensionCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return SCORING_POINT_ORDER.has(code);
}

export function filterAppealableCascadeItems<T extends AppealCascadeItem>(items: T[]): T[] {
  return items.filter((item) => isAppealableDimensionCode(item.dimensionCode ?? null));
}

function sectionSortKey(sectionCode: string | null | undefined): number {
  if (sectionCode && SECTION_ORDER.has(sectionCode as PerformanceSectionCode)) {
    return SECTION_ORDER.get(sectionCode as PerformanceSectionCode)!;
  }
  return 99;
}

function itemSortKey(dimensionCode: string | null | undefined): number {
  if (!dimensionCode) return 999;
  return SCORING_POINT_ORDER.get(dimensionCode) ?? 999;
}

/**
 * 按一级维度分组；组内按评分标准顺序排列 11 个评分项。
 */
export function groupAppealCascadeItems(
  items: AppealCascadeItem[],
): Array<{ sectionTitle: string; sectionCode?: string | null; items: AppealCascadeItem[] }> {
  const filtered = filterAppealableCascadeItems(items);
  const bySection = new Map<string, AppealCascadeItem[]>();
  const sectionMeta = new Map<string, string | null | undefined>();

  for (const item of filtered) {
    const key = item.sectionTitle || '其他';
    const list = bySection.get(key) ?? [];
    list.push(item);
    bySection.set(key, list);
    if (!sectionMeta.has(key)) sectionMeta.set(key, item.sectionCode);
  }

  for (const list of bySection.values()) {
    list.sort((a, b) => itemSortKey(a.dimensionCode) - itemSortKey(b.dimensionCode));
  }

  return Array.from(bySection.entries())
    .map(([sectionTitle, sectionItems]) => ({
      sectionTitle,
      sectionCode: sectionMeta.get(sectionTitle),
      items: sectionItems,
    }))
    .sort(
      (a, b) => sectionSortKey(a.sectionCode) - sectionSortKey(b.sectionCode),
    );
}
