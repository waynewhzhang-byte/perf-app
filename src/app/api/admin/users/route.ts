// 管理员：用户列表、手工创建、资料更新、重置密码、角色分配
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { getAuthConfig, usesStrongPassword } from '@/lib/auth-config';
import { validatePasswordPolicy } from '@/lib/password-policy';
import {
  HQ_BRANCH_NAME,
} from '@/lib/review-departments';
import {
  validateReviewerScope,
  validateRoleAccountBoundary,
} from '@/lib/reviewer-account-policy';

const fkId = z.string().max(50).optional().nullable();

function normalizeFk(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return value;
}

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    // Explicitly select fields to exclude passwordHash from the response.
    const users = await prisma.user.findMany({
      select: {
        id: true,
        contact: true,
        fullName: true,
        employeeNo: true,
        branchId: true,
        departmentId: true,
        positionId: true,
        jobTypeId: true,
        employeeLevelId: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            id: true,
            role: true,
            scopeBranchId: true,
            scopeDepartmentId: true,
            branch: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
        branch: true,
        department: true,
        employeeLevel: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, users });
  } catch (e) {
    console.error('GET /api/admin/users:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

const RoleSchema = z.object({
  action: z.enum(['add', 'remove']),
  userId: z.string(),
  role: z.enum(['EMPLOYEE', 'REVIEWER_L1', 'REVIEWER_L2', 'ADMIN']),
  scopeBranchId: z.string().nullable().optional(),
  scopeDepartmentId: z.string().nullable().optional(),
});

const CreateUserSchema = z.object({
  action: z.literal('create'),
  accountType: z.enum(['employee', 'reviewer']).default('employee'),
  contact: z.string().trim().min(3).max(255),
  password: z.string().trim(),
  fullName: z.string().trim().min(1).max(100),
  employeeNo: z.string().max(50).optional().nullable(),
  branchId: fkId,
  departmentId: fkId,
  positionId: fkId,
  jobTypeId: fkId,
  employeeLevelId: fkId,
  reviewerRole: z.enum(['REVIEWER_L1', 'REVIEWER_L2']).optional(),
  scopeBranchId: fkId,
  scopeDepartmentId: fkId,
});

const UpdateUserSchema = z.object({
  action: z.literal('update'),
  userId: z.string(),
  fullName: z.string().trim().min(1).max(100).optional(),
  employeeNo: z.string().max(50).optional().nullable(),
  branchId: fkId,
  departmentId: fkId,
  positionId: fkId,
  jobTypeId: fkId,
  employeeLevelId: fkId,
});

const SetPasswordSchema = z.object({
  action: z.literal('setPassword'),
  userId: z.string(),
  password: z.string().trim(),
});

const BodySchema = z.discriminatedUnion('action', [
  CreateUserSchema,
  UpdateUserSchema,
  SetPasswordSchema,
  RoleSchema,
]);

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });

    const authCfg = await getAuthConfig();
    const enforceStrong = usesStrongPassword(authCfg);

    if (parsed.data.action === 'create') {
      const {
        contact,
        password,
        fullName,
        employeeNo,
        branchId,
        departmentId,
        positionId,
        jobTypeId,
        employeeLevelId,
        accountType,
        reviewerRole,
        scopeBranchId,
        scopeDepartmentId,
      } = parsed.data;

      const pwdOk = validatePasswordPolicy(password, enforceStrong);
      if (!pwdOk.ok) {
        return NextResponse.json({ error: pwdOk.message }, { status: 400 });
      }

      const existing = await prisma.user.findUnique({ where: { contact } });
      if (existing) {
        return NextResponse.json({ error: '该登录账号已存在' }, { status: 409 });
      }

      const normalizedEmployeeNo = employeeNo?.trim() || null;
      if (accountType === 'employee' && !normalizedEmployeeNo) {
        return NextResponse.json({ error: '员工账号必须填写工号' }, { status: 400 });
      }

      let reviewerScope: {
        role: 'REVIEWER_L1' | 'REVIEWER_L2';
        branchId: string;
        departmentId: string | null;
      } | null = null;

      if (accountType === 'reviewer') {
        if (!reviewerRole) {
          return NextResponse.json({ error: '请选择审核级别' }, { status: 400 });
        }
        const normalizedBranchId = normalizeFk(scopeBranchId) ?? null;
        const normalizedDepartmentId = normalizeFk(scopeDepartmentId) ?? null;
        const [branch, department] = await Promise.all([
          normalizedBranchId
            ? prisma.branch.findUnique({ where: { id: normalizedBranchId } })
            : null,
          normalizedDepartmentId
            ? prisma.department.findUnique({ where: { id: normalizedDepartmentId } })
            : null,
        ]);
        const scopeValidation = validateReviewerScope({
          role: reviewerRole,
          branchId: normalizedBranchId,
          branchName: branch?.name ?? null,
          departmentId: normalizedDepartmentId,
          departmentName: department?.name ?? null,
          departmentBranchId: department?.branchId ?? null,
        });
        if (!scopeValidation.ok) {
          return NextResponse.json({ error: scopeValidation.error }, { status: 400 });
        }
        reviewerScope = {
          role: reviewerRole,
          branchId: normalizedBranchId!,
          departmentId: reviewerRole === 'REVIEWER_L1' && branch?.name !== HQ_BRANCH_NAME
            ? null
            : normalizedDepartmentId,
        };
      }

      let user;
      try {
        const passwordHash = await hashPassword(password);
        user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: accountType === 'reviewer'
              ? {
                  contact,
                  passwordHash,
                  fullName,
                  employeeNo: null,
                  branchId: reviewerScope!.branchId,
                  departmentId: reviewerScope!.departmentId,
                }
              : {
                  contact,
                  passwordHash,
                  fullName,
                  employeeNo: normalizedEmployeeNo,
                  branchId: normalizeFk(branchId) ?? null,
                  departmentId: normalizeFk(departmentId) ?? null,
                  positionId: normalizeFk(positionId) ?? null,
                  jobTypeId: normalizeFk(jobTypeId) ?? null,
                  employeeLevelId: normalizeFk(employeeLevelId) ?? null,
                },
            select: { id: true },
          });
          await tx.userRole.create({
            data: accountType === 'reviewer'
              ? {
                  userId: created.id,
                  role: reviewerScope!.role,
                  scopeBranchId: reviewerScope!.role === 'REVIEWER_L1'
                    ? reviewerScope!.branchId
                    : null,
                  scopeDepartmentId: reviewerScope!.departmentId,
                }
              : { userId: created.id, role: 'EMPLOYEE' },
          });
          return created;
        });
      } catch {
        return NextResponse.json({ error: '创建失败，请检查组织信息是否有效' }, { status: 400 });
      }

      return NextResponse.json({ success: true, userId: user.id });
    }

    if (parsed.data.action === 'update') {
      const { userId, fullName, employeeNo, branchId, departmentId, positionId, jobTypeId, employeeLevelId } =
        parsed.data;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, employeeNo: true, roles: { select: { role: true } } },
      });
      if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

      if (employeeNo !== undefined) {
        const nextEmployeeNo = employeeNo?.trim() || null;
        const hasReviewerRole = user.roles.some(
          ({ role }) => role === 'REVIEWER_L1' || role === 'REVIEWER_L2',
        );
        const hasEmployeeRole = user.roles.some(({ role }) => role === 'EMPLOYEE');
        if (hasReviewerRole && nextEmployeeNo) {
          return NextResponse.json({ error: '审核员账号不能设置员工工号' }, { status: 400 });
        }
        if (hasEmployeeRole && !nextEmployeeNo) {
          return NextResponse.json({ error: '员工账号必须保留工号' }, { status: 400 });
        }
      }

      const data: Record<string, unknown> = {};
      if (fullName !== undefined) data.fullName = fullName;
      if (employeeNo !== undefined) data.employeeNo = employeeNo?.trim() || null;
      if (branchId !== undefined) data.branchId = normalizeFk(branchId);
      if (departmentId !== undefined) data.departmentId = normalizeFk(departmentId);
      if (positionId !== undefined) data.positionId = normalizeFk(positionId);
      if (jobTypeId !== undefined) data.jobTypeId = normalizeFk(jobTypeId);
      if (employeeLevelId !== undefined) data.employeeLevelId = normalizeFk(employeeLevelId);

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
      }

      try {
        await prisma.user.update({ where: { id: userId }, data });
      } catch {
        return NextResponse.json({ error: '更新失败，请检查组织信息是否有效' }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    }

    if (parsed.data.action === 'setPassword') {
      const { userId, password } = parsed.data;

      const pwdOk = validatePasswordPolicy(password, enforceStrong);
      if (!pwdOk.ok) {
        return NextResponse.json({ error: pwdOk.message }, { status: 400 });
      }

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
      });

      return NextResponse.json({ success: true });
    }

    const { userId, role, action } = parsed.data;
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { branch: true, department: true },
    });
    if (!targetUser) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    const scopeBranchId = role === 'REVIEWER_L1' ? parsed.data.scopeBranchId ?? null : null;
    const scopeDepartmentId = role === 'REVIEWER_L1'
      ? parsed.data.scopeDepartmentId ?? null
      : role === 'REVIEWER_L2'
        ? parsed.data.scopeDepartmentId ?? targetUser.departmentId ?? null
        : null;

    if (action === 'add') {
      const boundary = validateRoleAccountBoundary(targetUser.employeeNo, role);
      if (!boundary.ok) {
        return NextResponse.json({ error: boundary.error }, { status: 400 });
      }
      if (
        role === 'REVIEWER_L2' &&
        parsed.data.scopeDepartmentId &&
        parsed.data.scopeDepartmentId !== targetUser.departmentId
      ) {
        return NextResponse.json({ error: '二级审核员审核部门必须与账号所属部门一致' }, { status: 400 });
      }
    }

    if (action === 'add' && role === 'REVIEWER_L1') {
      if (!scopeBranchId) {
        return NextResponse.json({ error: '一级审核员必须指定工区' }, { status: 400 });
      }
      const [branch, department] = await Promise.all([
        prisma.branch.findUnique({ where: { id: scopeBranchId } }),
        scopeDepartmentId
          ? prisma.department.findUnique({ where: { id: scopeDepartmentId } })
          : null,
      ]);
      if (!branch) return NextResponse.json({ error: '工区不存在' }, { status: 404 });
      const scopeValidation = validateReviewerScope({
        role,
        branchId: scopeBranchId,
        branchName: branch.name,
        departmentId: scopeDepartmentId,
        departmentName: department?.name ?? null,
        departmentBranchId: department?.branchId ?? null,
      });
      if (!scopeValidation.ok) {
        return NextResponse.json({ error: scopeValidation.error }, { status: 400 });
      }
    }

    if (action === 'add' && role === 'REVIEWER_L2') {
      const scopeValidation = validateReviewerScope({
        role,
        branchId: targetUser.branchId,
        branchName: targetUser.branch?.name ?? null,
        departmentId: targetUser.departmentId,
        departmentName: targetUser.department?.name ?? null,
        departmentBranchId: targetUser.department?.branchId ?? null,
      });
      if (!scopeValidation.ok) {
        return NextResponse.json({ error: scopeValidation.error }, { status: 400 });
      }
    }

    if (action === 'add') {
      try {
        await prisma.userRole.create({
          data: { userId, role, scopeBranchId, scopeDepartmentId },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
    } else {
      await prisma.userRole.deleteMany({
        where: { userId, role, scopeBranchId, scopeDepartmentId },
      });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/admin/users:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
