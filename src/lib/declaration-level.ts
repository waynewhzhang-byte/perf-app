/**
 * 能级等级计算
 *
 * 基于参加工作时间到评价截止日的整年工作年限计算申报能级。
 * 规则：
 *   - 0 ≤ years < 5  → 三级
 *   - 5 ≤ years < 9  → 二级
 *   - 9 ≤ years       → 一级
 */

export const DECLARATION_LEVELS = ['一级', '二级', '三级'] as const;
export type DeclarationLevel = (typeof DECLARATION_LEVELS)[number];

/**
 * `DeclarationTier` 是 `DeclarationLevel` 的历史别名（早期模块用 "tier" 命名）。
 * 保留别名以兼容现有引用；新代码请直接使用 `DeclarationLevel`。
 */
export type DeclarationTier = DeclarationLevel;

/** 工作年限 → 能级等级 */
export function computeLevel(workYears: number): DeclarationLevel {
  if (workYears < 5) return '三级';
  if (workYears < 9) return '二级';
  return '一级';
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

/** 从 User.profile 读取模拟能级（入库字段 mockDeclarationTier: 一级|二级|三级） */
export function parseMockDeclarationTier(profile: unknown): DeclarationLevel | null {
  if (!profile || typeof profile !== 'object') return null;
  const tier = (profile as { mockDeclarationTier?: string }).mockDeclarationTier?.trim();
  if (tier === '一级' || tier === '二级' || tier === '三级') return tier;
  return null;
}
