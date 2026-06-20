import type { BasicDimension } from '@prisma/client';

export const BASIC_DIMENSION_TO_CODE: Record<BasicDimension, string> = {
  SKILL_LEVEL: 'basic.skill-level',
  TITLE_LEVEL: 'basic.title-level',
  PERFORMANCE_LEVEL: 'basic.performance-level',
};

export const BASIC_DIMENSION_LABELS: Record<BasicDimension, string> = {
  SKILL_LEVEL: '技能等级',
  TITLE_LEVEL: '职称等级',
  PERFORMANCE_LEVEL: '绩效等级',
};

export function isBasicDimensionCode(code: string): boolean {
  return code.startsWith('basic.');
}

export function basicDimensionFromCode(code: string): BasicDimension | null {
  const entry = Object.entries(BASIC_DIMENSION_TO_CODE).find(([, c]) => c === code);
  return entry ? (entry[0] as BasicDimension) : null;
}
