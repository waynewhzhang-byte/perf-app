import type { AppRole } from '@prisma/client';
import {
  HQ_BRANCH_NAME,
  isSecondLevelReviewDepartment,
} from './review-departments';

export type ReviewerRole = Extract<AppRole, 'REVIEWER_L1' | 'REVIEWER_L2'>;

interface ReviewerScopeInput {
  role: ReviewerRole;
  branchId: string | null;
  branchName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  departmentBranchId: string | null;
}

export function validateReviewerScope(
  input: ReviewerScopeInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.branchId || !input.branchName) {
    return { ok: false, error: '审核员必须指定审核范围' };
  }

  const departmentBelongsToBranch =
    Boolean(input.departmentId) && input.departmentBranchId === input.branchId;

  if (input.role === 'REVIEWER_L1') {
    if (input.branchName === HQ_BRANCH_NAME) {
      if (!departmentBelongsToBranch) {
        return { ok: false, error: '公司总部一级审核员必须指定总部二级部门' };
      }
      return { ok: true };
    }

    if (input.departmentId) {
      return { ok: false, error: '普通工区一级审核员按工区授权，无需指定部门' };
    }
    return { ok: true };
  }

  if (
    input.branchName !== HQ_BRANCH_NAME ||
    !departmentBelongsToBranch ||
    !isSecondLevelReviewDepartment(input.departmentName)
  ) {
    return {
      ok: false,
      error: '二级审核员只能归属公司总部的公司组织部、公司安监部或公司运检部',
    };
  }
  return { ok: true };
}

export function validateRoleAccountBoundary(
  employeeNo: string | null,
  role: AppRole,
): { ok: true } | { ok: false; error: string } {
  if (employeeNo && (role === 'REVIEWER_L1' || role === 'REVIEWER_L2')) {
    return { ok: false, error: '员工账号不能授予审核员角色，请创建独立审核员账号' };
  }
  if (!employeeNo && role === 'EMPLOYEE') {
    return { ok: false, error: '独立管理或审核账号不能授予员工角色' };
  }
  return { ok: true };
}
