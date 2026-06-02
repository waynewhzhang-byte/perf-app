import { randomUUID } from 'crypto';

export interface ScoreOptionLike {
  optionId?: string;
  label: string;
  score: number;
  description?: string;
}

export interface SelectedOptionLike {
  index: number;
  optionId?: string;
  label?: string;
  score?: number;
  count?: number;
}

export function ensureScoreOptionIds(options: ScoreOptionLike[]): ScoreOptionLike[] {
  return options.map((option) => ({
    ...option,
    optionId: option.optionId || randomUUID(),
  }));
}

export function optionIdForIndex(itemId: string, index: number): string {
  return `${itemId}:${index}`;
}

export function optionWithFallbackId(
  option: ScoreOptionLike,
  itemId: string,
  index: number,
): ScoreOptionLike & { optionId: string } {
  return {
    ...option,
    optionId: option.optionId || optionIdForIndex(itemId, index),
  };
}

export function normalizeSelectedOptions(
  itemId: string,
  scoreOptions: ScoreOptionLike[],
  selected: SelectedOptionLike[],
): Array<{ index: number; optionId: string; label: string; score: number; count?: number }> {
  const options = scoreOptions.map((option, index) => optionWithFallbackId(option, itemId, index));
  return selected.flatMap((selection) => {
    const option = selection.optionId
      ? options.find((candidate) => candidate.optionId === selection.optionId)
      : options[selection.index];
    if (!option) return [];
    return [{
      index: options.findIndex((candidate) => candidate.optionId === option.optionId),
      optionId: option.optionId,
      label: option.label,
      score: Number(option.score ?? 0),
      count: selection.count,
    }];
  });
}
