/**
 * 导入预览试算：按 itemCode 分发到对应计分函数。
 *
 * 评分事实类（tickets/defects/safety）的完整试算需 ScoringRule，
 * 由 preview 路由从 DB 加载后调用 computeFactScores（见 preview/route.ts）；
 * 基本素质类用纯档位表 previewBasicFacts；
 * 员工档案类无分数，由路由层返回「将新建/将更新」状态。
 */
import { buildBasicFactDrafts, type BasicFactFieldMapping, type BasicFactTiers } from './basic-fact-import';

export interface BasicPreviewRow {
  employeeNo: string;
  employeeName: string;
  skillScore: number;
  titleScore: number;
  performanceScore: number;
}

/** 基本素质试算：每行三维度得分 */
export function previewBasicFacts(
  mapping: BasicFactFieldMapping,
  rows: Record<string, string>[],
  tiers: BasicFactTiers,
): BasicPreviewRow[] {
  const drafts = buildBasicFactDrafts(mapping, rows, 0, tiers);
  const grouped = new Map<string, BasicPreviewRow>();
  for (const d of drafts) {
    let r = grouped.get(d.employeeNo);
    if (!r) {
      r = { employeeNo: d.employeeNo, employeeName: d.employeeName, skillScore: 0, titleScore: 0, performanceScore: 0 };
      grouped.set(d.employeeNo, r);
    }
    if (d.dimension === 'SKILL_LEVEL') r.skillScore = d.score;
    else if (d.dimension === 'TITLE_LEVEL') r.titleScore = d.score;
    else if (d.dimension === 'PERFORMANCE_LEVEL') r.performanceScore = d.score;
  }
  return [...grouped.values()];
}
