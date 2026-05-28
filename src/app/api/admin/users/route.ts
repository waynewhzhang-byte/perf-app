// 管理员：用户列表、手工创建、资料更新、重置密码、角色分配
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { getAuthConfig, usesStrongPassword } from '@/lib/auth-config';
import { validatePasswordPolicy } from '@/lib/password-policy';

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
        roles: true,
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
});

const CreateUserSchema = z.object({
  action: z.literal('create'),
  contact: z.string().trim().min(3).max(255),
  password: z.string().trim(),
  fullName: z.string().trim().min(1).max(100),
  employeeNo: z.string().max(50).optional().nullable(),
  branchId: fkId,
  departmentId: fkId,
  positionId: fkId,
  jobTypeId: fkId,
  employeeLevelId: fkId,
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
      } = parsed.data;

      const pwdOk = validatePasswordPolicy(password, enforceStrong);
      if (!pwdOk.ok) {
        return NextResponse.json({ error: pwdOk.message }, { status: 400 });
      }

      const existing = await prisma.user.findUnique({ where: { contact } });
      if (existing) {
        return NextResponse.json({ error: '该联系方式已存在' }, { status: 409 });
      }

      let user;
      try {
        user = await prisma.user.create({
          data: {
            contact,
            passwordHash: await hashPassword(password),
            fullName,
            employeeNo: employeeNo?.trim() || null,
            branchId: normalizeFk(branchId) ?? null,
            departmentId: normalizeFk(departmentId) ?? null,
            positionId: normalizeFk(positionId) ?? null,
            jobTypeId: normalizeFk(jobTypeId) ?? null,
            employeeLevelId: normalizeFk(employeeLevelId) ?? null,
            roles: { create: { role: 'EMPLOYEE' } },
          },
          select: { id: true },
        });
      } catch {
        return NextResponse.json({ error: '创建失败，请检查组织信息是否有效' }, { status: 400 });
      }

      return NextResponse.json({ success: true, userId: user.id });
    }

    if (parsed.data.action === 'update') {
      const { userId, fullName, employeeNo, branchId, departmentId, positionId, jobTypeId, employeeLevelId } =
        parsed.data;

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

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
        data: { passwordHash: await hashPassword(password) },
      });

      return NextResponse.json({ success: true });
    }

    const { userId, role, scopeBranchId, action } = parsed.data;

    if (action === 'add') {
      await prisma.userRole
        .upsert({
          where: {
            userId_role_scopeBranchId: { userId, role, scopeBranchId: scopeBranchId ?? null } as Parameters<
              typeof prisma.userRole.upsert
            >[0]['where']['userId_role_scopeBranchId'],
          },
          update: {},
          create: { userId, role, scopeBranchId: scopeBranchId ?? null },
        })
        .catch(async () => {
          const exist = await prisma.userRole.findFirst({
            where: { userId, role, scopeBranchId: scopeBranchId ?? null },
          });
          if (!exist) {
            await prisma.userRole.create({
              data: { userId, role, scopeBranchId: scopeBranchId ?? null },
            });
          }
        });
    } else {
      await prisma.userRole.deleteMany({
        where: { userId, role, scopeBranchId: scopeBranchId ?? null },
      });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/admin/users:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
