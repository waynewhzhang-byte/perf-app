/**
 * 共享四舍五入工具。
 *
 * `round1` / `round2` / `round4` 曾在多个评分 / 报表模块内各自复制；
 * 此处集中提供单一实现，行为与原各副本数学等价（仅小数位精度不同）。
 */

/** 保留一位小数（维度聚合、分表总分用） */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 保留两位小数（事实积分过程、扣分汇总、报表列用） */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 保留四位小数（完成率等比率字段用） */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
