import { prisma } from '@/lib/prisma';

export type ReviewProgressBlocker = {
  level: 'L1' | 'L2';
  code: string;
  label: string;
  count: number;
  scope?: string;
};

export type ReviewProgress = {
  templateId: string;
  templateTitle: string;
  year: number;
  totalEmployees: number;
  submittedEmployees: number;
  approvedEmployees: number;
  statusCounts: Record<string, number>;
  l1: {
    pendingSubmissions: number;
    branches: Array<{ branchId: string | null; branchName: string; count: number; reviewerCount: number }>;
  };
  l2: {
    pendingSubmissions: number;
    pendingOptions: number;
    departments: Array<{ departmentId: string; departmentName: string; count: number; submissionCount: number; reviewerCount: number }>;
  };
  blockers: ReviewProgressBlocker[];
  complete: boolean;
};

type ProgressOptions = { branchId?: string };

export async function getReviewProgress(templateId: string, options: ProgressOptions = {}): Promise<ReviewProgress | null> {
  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, title: true, year: true },
  });
  if (!template) return null;

  const employeeWhere = {
    roles: { some: { role: 'EMPLOYEE' as const } },
    ...(options.branchId ? { branchId: options.branchId } : {}),
  };
  const submissionWhere = {
    templateId,
    ...(options.branchId
      ? { OR: [{ branchId: options.branchId }, { branchId: null, user: { branchId: options.branchId } }] }
      : {}),
  };

  const [employees, submissions, l1Reviewers, l2Reviewers] = await Promise.all([
    prisma.user.findMany({
      where: employeeWhere,
      select: { id: true, branchId: true, branch: { select: { name: true } } },
    }),
    prisma.submission.findMany({
      where: submissionWhere,
      select: {
        id: true,
        userId: true,
        status: true,
        branchId: true,
        branch: { select: { name: true } },
        user: { select: { branch: { select: { id: true, name: true } } } },
        items: {
          select: {
            optionReviews: {
              where: { status: 'PENDING_L2' },
              select: { departmentId: true, department: { select: { name: true } } },
            },
          },
        },
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { level: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.userRole.findMany({
      where: { role: 'REVIEWER_L1' },
      select: { scopeBranchId: true },
    }),
    prisma.userRole.findMany({
      where: { role: 'REVIEWER_L2' },
      select: { scopeDepartmentId: true, user: { select: { departmentId: true } } },
    }),
  ]);

  const employeeIds = new Set(employees.map((employee) => employee.id));
  const scopedSubmissions = submissions.filter((submission) => employeeIds.has(submission.userId));
  const statusCounts: Record<string, number> = {};
  for (const submission of scopedSubmissions) {
    statusCounts[submission.status] = (statusCounts[submission.status] ?? 0) + 1;
  }

  const reviewerCountByBranch = new Map<string, number>();
  for (const reviewer of l1Reviewers) {
    if (reviewer.scopeBranchId) reviewerCountByBranch.set(reviewer.scopeBranchId, (reviewerCountByBranch.get(reviewer.scopeBranchId) ?? 0) + 1);
  }
  const reviewerCountByDepartment = new Map<string, number>();
  for (const reviewer of l2Reviewers) {
    const departmentId = reviewer.scopeDepartmentId ?? reviewer.user.departmentId;
    if (departmentId) {
      reviewerCountByDepartment.set(
        departmentId,
        (reviewerCountByDepartment.get(departmentId) ?? 0) + 1,
      );
    }
  }

  const branchProgress = new Map<string, { branchId: string | null; branchName: string; count: number; reviewerCount: number }>();
  const employeeCountByBranch = new Map<string, { branchId: string | null; branchName: string; count: number; reviewerCount: number }>();
  for (const employee of employees) {
    const key = employee.branchId ?? 'missing';
    const current = employeeCountByBranch.get(key) ?? {
      branchId: employee.branchId,
      branchName: employee.branch?.name ?? '未配置工区',
      count: 0,
      reviewerCount: employee.branchId ? reviewerCountByBranch.get(employee.branchId) ?? 0 : 0,
    };
    current.count += 1;
    employeeCountByBranch.set(key, current);
  }
  for (const submission of scopedSubmissions.filter((item) => item.status === 'SUBMITTED')) {
    const branchId = submission.branchId ?? submission.user.branch?.id ?? null;
    const branchName = submission.branch?.name ?? submission.user.branch?.name ?? '未配置工区';
    const key = branchId ?? 'missing';
    const current = branchProgress.get(key) ?? {
      branchId,
      branchName,
      count: 0,
      reviewerCount: branchId ? reviewerCountByBranch.get(branchId) ?? 0 : 0,
    };
    current.count += 1;
    branchProgress.set(key, current);
  }

  const departmentProgress = new Map<string, { departmentId: string; departmentName: string; count: number; submissions: Set<string>; reviewerCount: number }>();
  for (const submission of scopedSubmissions.filter((item) => item.status === 'L1_APPROVED')) {
    for (const item of submission.items) {
      for (const review of item.optionReviews) {
        const current = departmentProgress.get(review.departmentId) ?? {
          departmentId: review.departmentId,
          departmentName: review.department.name,
          count: 0,
          submissions: new Set<string>(),
          reviewerCount: reviewerCountByDepartment.get(review.departmentId) ?? 0,
        };
        current.count += 1;
        current.submissions.add(submission.id);
        departmentProgress.set(review.departmentId, current);
      }
    }
  }

  const blockers: ReviewProgressBlocker[] = [];
  const submissionByEmployee = new Map(scopedSubmissions.map((submission) => [submission.userId, submission]));
  const missingSubmissionCount = employees.filter((employee) => !submissionByEmployee.has(employee.id)).length;
  if (missingSubmissionCount > 0) {
    blockers.push({ level: 'L1', code: 'MISSING_SUBMISSION', label: '员工尚未提交申报', count: missingSubmissionCount });
  }
  for (const [status, label] of [
    ['DRAFT', '草稿未提交'],
    ['PRE_REVIEW_REJECTED', '自动预审未通过，待员工修改'],
  ] as const) {
    const count = scopedSubmissions.filter((submission) => submission.status === status).length;
    if (count > 0) blockers.push({ level: 'L1', code: status, label, count });
  }
  const rejectedByLevel = new Map<number, number>();
  for (const submission of scopedSubmissions.filter((item) => item.status === 'REJECTED')) {
    const level = submission.logs[0]?.level === 2 ? 2 : 1;
    rejectedByLevel.set(level, (rejectedByLevel.get(level) ?? 0) + 1);
  }
  for (const [level, count] of rejectedByLevel) {
    blockers.push({
      level: level === 2 ? 'L2' : 'L1',
      code: level === 2 ? 'REJECTED_L2' : 'REJECTED_L1',
      label: level === 2 ? '二级审核驳回，待员工重新提交' : '一级审核驳回，待员工重新提交',
      count,
    });
  }
  for (const branch of employeeCountByBranch.values()) {
    const outstandingCount = scopedSubmissions.filter((submission) => {
      const branchId = submission.branchId ?? submission.user.branch?.id ?? null;
      return branchId === branch.branchId && submission.status !== 'L2_APPROVED';
    }).length + employees.filter((employee) => {
      const employeeSubmission = submissionByEmployee.get(employee.id);
      return employee.branchId === branch.branchId && !employeeSubmission;
    }).length;
    if (outstandingCount > 0 && branch.reviewerCount === 0) {
      blockers.push({ level: 'L1', code: 'MISSING_L1_REVIEWER', label: '未配置一级审核员', count: outstandingCount, scope: branch.branchName });
    }
  }
  for (const branch of branchProgress.values()) {
    if (branch.reviewerCount === 0) continue;
    blockers.push({
      level: 'L1',
      code: 'PENDING_L1',
      label: '一级审核待处理',
      count: branch.count,
      scope: branch.branchName,
    });
  }
  for (const department of departmentProgress.values()) {
    blockers.push({
      level: 'L2',
      code: department.reviewerCount > 0 ? 'PENDING_L2' : 'MISSING_L2_REVIEWER',
      label: department.reviewerCount > 0 ? '二级审核待处理' : '未配置二级审核员',
      count: department.count,
      scope: department.departmentName,
    });
  }

  const submittedEmployees = new Set(
    scopedSubmissions
      .filter((submission) => ['SUBMITTED', 'L1_APPROVED', 'L2_APPROVED'].includes(submission.status))
      .map((submission) => submission.userId),
  );
  const approvedEmployees = new Set(
    scopedSubmissions.filter((submission) => submission.status === 'L2_APPROVED').map((submission) => submission.userId),
  );

  return {
    templateId: template.id,
    templateTitle: template.title,
    year: template.year,
    totalEmployees: employees.length,
    submittedEmployees: submittedEmployees.size,
    approvedEmployees: approvedEmployees.size,
    statusCounts,
    l1: {
      pendingSubmissions: scopedSubmissions.filter((submission) => submission.status === 'SUBMITTED').length,
      branches: [...branchProgress.values()],
    },
    l2: {
      pendingSubmissions: scopedSubmissions.filter((submission) => submission.status === 'L1_APPROVED').length,
      pendingOptions: [...departmentProgress.values()].reduce((total, department) => total + department.count, 0),
      departments: [...departmentProgress.values()].map(({ submissions: pendingSubmissions, ...department }) => ({
        ...department,
        submissionCount: pendingSubmissions.size,
      })),
    },
    blockers,
    complete: employees.length > 0 && approvedEmployees.size === employees.length,
  };
}
