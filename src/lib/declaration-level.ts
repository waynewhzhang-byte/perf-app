/**
 * 能级等级计算
 *
 * 基于入职时间到当前日期的整年工作年限计算申报能级。
 * 规则：类似 PreReviewRule 的工龄区间映射
 *   - 0 ≤ years < 5  → 一级
 *   - 5 ≤ years < 8  → 二级
 *   - 8 ≤ years       → 三级
 */

export const DECLARATION_LEVELS = ['一级', '二级', '三级'] as const;
export type DeclarationLevel = (typeof DECLARATION_LEVELS)[number];

/** 工作年限 → 能级等级 */
export function computeLevel(workYears: number): DeclarationLevel {
  if (workYears < 5) return '一级';
  if (workYears < 8) return '二级';
  return '三级';
}

/** 入职日期 → 能级等级（用截至当前日期的整数年限） */
export function levelFromHireDate(hireDate: Date, asOf: Date = new Date()): DeclarationLevel {
  let years = asOf.getFullYear() - hireDate.getFullYear();
  const asOfMonth = asOf.getMonth();
  const hireMonth = hireDate.getMonth();
  if (asOfMonth < hireMonth || (asOfMonth === hireMonth && asOf.getDate() < hireDate.getDate())) {
    years -= 1;
  }
  return computeLevel(Math.max(0, years));
}
