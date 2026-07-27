/**
 * 申报项计分与入职日期解析（UI 预览与服务端共用）。
 * 无 Zod / Prisma，可安全被 'use client' 页面引用。
 */

/** 解析 YYYY-MM-DD 格式日期字符串，无效时返回 null */
export function parseDateOnly(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** 权威计分：COUNTED 按 单价×次数 汇总并封顶；TIERS 累加选中分值 */
export function computeItemScore(
  meta: { scoreMode: string; maxScore: number | null } | undefined,
  selected: Array<{ score: number; count?: number }>,
): number {
  if (meta?.scoreMode === 'COUNTED') {
    const raw = selected.reduce((sum, s) => sum + s.score * (s.count ?? 0), 0);
    const cap = meta.maxScore ?? Infinity;
    return Math.min(raw, cap);
  }
  return selected.reduce((sum, s) => sum + s.score, 0);
}
