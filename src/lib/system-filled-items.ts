/**
 * 系统填充项：导入事实 + 评分规则 → 申报表自动带入，员工确认/申诉。
 */
import {
  inferDimensionCodeFromTitle,
  SCORING_STANDARD_BY_CODE,
} from '@/lib/scoring-standards';
import type { DimensionScoreRow, PerformanceScoreSheet } from '@/lib/performance-score-sheet';

export type ConfirmationStatus = 'CONFIRMED' | 'DISPUTED';

export interface FormItemDimensionLike {
  id: string;
  title: string;
  dimensionCode?: string | null;
}

export function resolveFormItemDimension(item: {
  dimensionCode?: string | null;
  title: string;
}): string | null {
  if (item.dimensionCode) return item.dimensionCode;
  return inferDimensionCodeFromTitle(item.title);
}

export function isFactDataSourceDimension(code: string | null | undefined): boolean {
  if (!code) return false;
  return SCORING_STANDARD_BY_CODE[code]?.dataSource === 'fact';
}

export interface SystemFilledItemPayload {
  itemId: string;
  dimensionCode: string;
  title: string;
  score: number;
  ruleSummary: string;
  selected: Array<{ index: number; label: string; score: number; count?: number }>;
}

/** 从绩效分表提取应系统填充且有导入事实的申报项 */
export function extractSystemFilledFromSheet(
  sheet: PerformanceScoreSheet,
): SystemFilledItemPayload[] {
  const rows: SystemFilledItemPayload[] = [];
  for (const sec of sheet.sections) {
    for (const row of sec.items) {
      if (!row.itemId) continue;
      if (row.source !== 'FACT') continue;
      if (!row.hasImportedFacts) continue;
      rows.push({
        itemId: row.itemId,
        dimensionCode: row.dimensionCode,
        title: row.title,
        score: row.score,
        ruleSummary: row.ruleSummary,
        selected: row.lines.map((line, index) => ({
          index,
          label: line.label,
          score: line.score,
        })),
      });
    }
  }
  return rows;
}

/** 模板项中绑定事实维度的 itemId 集合（含标题推断） */
export function factBoundItemIds(items: FormItemDimensionLike[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const code = resolveFormItemDimension(item);
    if (isFactDataSourceDimension(code)) ids.add(item.id);
  }
  return ids;
}

export function systemItemStatusOnSubmit(
  submit: boolean,
  confirmationStatus?: ConfirmationStatus | null,
): 'DRAFT' | 'PENDING_L1' | 'L1_APPROVED' {
  if (!submit) return 'DRAFT';
  return confirmationStatus === 'CONFIRMED' ? 'L1_APPROVED' : 'PENDING_L1';
}

/** 已确认的系统填充项无需 L1 逐项审核 */
export function isReviewSkippedSystemItem(item: {
  isSystemFilled: boolean;
  confirmationStatus?: ConfirmationStatus | null;
}): boolean {
  return item.isSystemFilled && item.confirmationStatus === 'CONFIRMED';
}

/** 系统填充项不参与 L2 子项分配审核 */
export function shouldCreateOptionReviews(item: {
  isSystemFilled: boolean;
}): boolean {
  return !item.isSystemFilled;
}

export function scoreSheetToItemScores(
  sheet: PerformanceScoreSheet,
): Map<string, { score: number; isSystemFilled: boolean }> {
  const map = new Map<string, { score: number; isSystemFilled: boolean }>();
  for (const row of extractSystemFilledFromSheet(sheet)) {
    map.set(row.itemId, { score: row.score, isSystemFilled: true });
  }
  return map;
}

export type DimensionScoreRowExport = DimensionScoreRow;
