import { SCORING_STANDARD_BY_CODE, SCORING_STANDARDS } from './scoring-standards';

export interface ReviewPointDefinition {
  dimensionCode: string;
  title: string;
  sectionCode: string;
  sectionTitle: string;
  maxScore: number;
  dataSource: string;
  ownerDepartment: string;
  scoringSummary: string;
}

/** 系统按事实与积分规则生成的最终评分点，路由配置不依赖表单模板。 */
export function reviewPointDefinitions(): ReviewPointDefinition[] {
  return SCORING_STANDARDS.map((standard) => ({
    dimensionCode: standard.code,
    title: standard.title,
    sectionCode: standard.sectionCode,
    sectionTitle: standard.sectionTitle,
    maxScore: standard.maxScore,
    dataSource: standard.dataSource,
    ownerDepartment: standard.ownerDepartment,
    scoringSummary: standard.scoringSummary,
  }));
}

export function isReviewableDimensionCode(dimensionCode: string): boolean {
  return Boolean(SCORING_STANDARD_BY_CODE[dimensionCode]);
}

/** SubmissionOptionReview 复用的稳定键：每个最终评分点只生成一条二审记录。 */
export function dimensionReviewOptionId(dimensionCode: string): string {
  return `dimension:${dimensionCode}`;
}
