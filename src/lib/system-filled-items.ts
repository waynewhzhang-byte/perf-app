/**
 * 系统填充项：导入事实 + 评分规则 → 申报表自动带入，员工确认/申诉。
 */
import {
  inferDimensionCodeFromTitle,
  SCORING_STANDARD_BY_CODE,
} from '@/lib/scoring-standards';
import type { DimensionScoreRow, PerformanceScoreSheet } from '@/lib/performance-score-sheet';

export type ConfirmationStatus = 'CONFIRMED' | 'DISPUTED';

/** 表头中由员工花名册自动带出的参加工作时间确认项。 */
export const HIRE_DATE_CONFIRMATION_CODE = 'profile.hire-date';

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
  const source = SCORING_STANDARD_BY_CODE[code]?.dataSource;
  return source === 'fact' || source === 'deduction';
}

/** 事实维度与系统带出的参加工作时间都只能确认或申诉，不能由员工填写分数。 */
export function isSystemConfirmationDimension(code: string | null | undefined): boolean {
  return code === HIRE_DATE_CONFIRMATION_CODE || isFactDataSourceDimension(code);
}

export interface SystemFilledItemPayload {
  itemId: string;
  dimensionCode: string;
  title: string;
  score: number;
  ruleSummary: string;
  selected: Array<{ index: number; label: string; score: number; count?: number }>;
}

/**
 * 从绩效分表提取所有事实评分项。
 *
 * 即使当前没有导入事实，也要生成 0 分系统项：员工只能确认“暂无事实”或提交
 * 缺失事实申诉，不能绕过评分标准自行填写分数。
 */
export function extractSystemFilledFromSheet(
  sheet: PerformanceScoreSheet,
): SystemFilledItemPayload[] {
  const rows: SystemFilledItemPayload[] = [];
  for (const sec of sheet.sections) {
    for (const row of sec.items) {
      if (!row.itemId) continue;
      if (!isFactDataSourceDimension(row.dimensionCode)) continue;
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
