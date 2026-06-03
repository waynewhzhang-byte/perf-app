/** 申报项计分与章节聚合（与模板预览、归档雷达图共用） */

export type ScoreMode = 'TIERS' | 'COUNTED';

export interface ScoreOptionLike {
  label?: string;
  score?: number;
}

export interface ScorableItem {
  id?: string;
  scoreMode?: ScoreMode | string;
  maxScore?: number | null;
  maxSelections?: number;
  scoreOptions: ScoreOptionLike[] | unknown;
  sortOrder?: number;
}

export interface ScorableSection {
  id?: string;
  title: string;
  sortOrder?: number;
  items: ScorableItem[];
}

export interface SectionScoreRow {
  sectionId: string;
  title: string;
  sortOrder: number;
  score: number;
  maxScore: number;
  completionRate: number;
  gap: number;
}

function parseScoreOptions(raw: unknown): ScoreOptionLike[] {
  if (!Array.isArray(raw)) return [];
  return raw as ScoreOptionLike[];
}

/** 单个申报项理论满分 */
export function computeItemMaxScore(item: ScorableItem): number {
  if (item.scoreMode === 'COUNTED') {
    return Number(item.maxScore ?? 0);
  }
  const scores = parseScoreOptions(item.scoreOptions)
    .map((o) => Number(o.score ?? 0))
    .filter((n) => !Number.isNaN(n));
  if (scores.length === 0) return 0;
  const maxSelections = Math.max(1, item.maxSelections ?? 1);
  if (maxSelections === 1) {
    return Math.max(...scores);
  }
  return [...scores]
    .sort((a, b) => b - a)
    .slice(0, maxSelections)
    .reduce((a, b) => a + b, 0);
}

/** 模板全表理论满分 */
export function computeTemplateMaxScore(sections: ScorableSection[]): number {
  const sorted = sortScorableSections(sections);
  return sorted.reduce(
    (sum, sec) => sum + sec.items.reduce((is, it) => is + computeItemMaxScore(it), 0),
    0,
  );
}

export function sortScorableSections<T extends ScorableSection>(sections: T[]): T[] {
  return [...sections]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((s) => ({
      ...s,
      items: [...s.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    }));
}

/** 按章节聚合实际分与满分 */
export function computeSectionScores(
  sections: ScorableSection[],
  scoreByItemId: Map<string, number>,
): SectionScoreRow[] {
  const sorted = sortScorableSections(sections);
  return sorted.map((sec, idx) => {
    const sectionId = sec.id ?? `section-${idx}`;
    let score = 0;
    let maxScore = 0;
    for (const it of sec.items) {
      const itemId = it.id;
      if (itemId && scoreByItemId.has(itemId)) {
        score += scoreByItemId.get(itemId)!;
      }
      maxScore += computeItemMaxScore(it);
    }
    const completionRate = maxScore > 0 ? score / maxScore : 0;
    const gap = Math.max(0, maxScore - score);
    return {
      sectionId,
      title: sec.title,
      sortOrder: sec.sortOrder ?? idx,
      score: round1(score),
      maxScore: round1(maxScore),
      completionRate: round4(completionRate),
      gap: round1(gap),
    };
  });
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
