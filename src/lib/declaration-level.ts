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

/** 年度评价统一按当年 7 月 31 日计算工龄，避免报表随导出日期漂移。 */
export function evaluationCutoffDate(year: number): Date {
  return new Date(Date.UTC(year, 6, 31));
}

/** 从员工档案快照读取参加工作时间。 */
export function workStartDateFromProfile(profile: unknown): Date | null {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const value = String((profile as Record<string, unknown>)['参加工作时间'] ?? '').trim();
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 优先使用员工已填入的入职时间，历史花名册数据回退到 profile 快照。 */
export function effectiveHireDate(hireDate: Date | null | undefined, profile: unknown): Date | null {
  return hireDate ?? workStartDateFromProfile(profile);
}

/** 工作年限 → 能级等级 */
export function computeLevel(workYears: number): DeclarationLevel {
  if (workYears < 5) return '三级';
  if (workYears < 9) return '二级';
  return '一级';
}

/** 自动计算值兼容等级字典的中文与数字两种命名。 */
export function declarationLevelNameCandidates(level: DeclarationLevel): string[] {
  const numericName = level === '一级' ? '1级' : level === '二级' ? '2级' : '3级';
  return [level, numericName];
}

/**
 * 展示用能级标签：统一阿拉伯数字（1级/2级/3级），与报表更一致。
 * 接受「一级」「1级」「能级评价一级」等输入。
 */
export function formatDeclarationLevelDisplay(level: string | null | undefined): string | null {
  if (!level?.trim()) return null;
  const raw = level.trim();
  if (/1\s*级/.test(raw) || raw.includes('一级')) return '1级';
  if (/2\s*级/.test(raw) || raw.includes('二级')) return '2级';
  if (/3\s*级/.test(raw) || raw.includes('三级')) return '3级';
  return null;
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
