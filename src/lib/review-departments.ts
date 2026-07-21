import { HQ_BRANCH_NAME } from './org-mapping';

export { HQ_BRANCH_NAME };

export const SECOND_LEVEL_REVIEW_DEPARTMENT_NAMES = [
  '公司组织部',
  '公司安监部',
  '公司运检部',
] as const;

export function isSecondLevelReviewDepartment(name: string | null | undefined): boolean {
  return SECOND_LEVEL_REVIEW_DEPARTMENT_NAMES.some((departmentName) => departmentName === name);
}
