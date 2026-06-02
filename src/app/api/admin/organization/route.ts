// 组织架构 CRUD（工区/部门/岗位/工种/员工级别/申报字典）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

const EntitySchema = z.object({
  entity: z.enum(['branch', 'department', 'position', 'jobType', 'employeeLevel', 'declarationLevel', 'declarationSpecialty']),
});

const CreateSchema = EntitySchema.extend({
  name: z.string().min(1).max(100),
  code: z.string().max(50).optional(),
  branchId: z.string().optional(),                // 仅 department
});

const UpdateSchema = EntitySchema.extend({
  id: z.string(),
  name: z.string().min(1).max(100),
  code: z.string().max(50).optional().nullable(), // 仅 branch
});

const DeleteSchema = EntitySchema.extend({ id: z.string() });

const ENTITY_LABEL: Record<z.infer<typeof EntitySchema>['entity'], string> = {
  branch: '工区',
  department: '部门',
  position: '岗位',
  jobType: '工种',
  employeeLevel: '员工级别',
  declarationLevel: '能级评价等级',
  declarationSpecialty: '能级评价专业',
};




export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const [branches, departments, positions, jobTypes, employeeLevels, declarationLevels, declarationSpecialties] = await Promise.all([
      prisma.branch.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.department.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.position.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.jobType.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.employeeLevel.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.declarationLevel.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.declarationSpecialty.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return NextResponse.json({ success: true, branches, departments, positions, jobTypes, employeeLevels, declarationLevels, declarationSpecialties });
  } catch (e) {
    console.error('GET /api/admin/organization:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const { entity, name, code, branchId } = parsed.data;

    switch (entity) {
      case 'branch': {
        const created = await prisma.branch.create({ data: { name, code: code || null } });
        return NextResponse.json({ success: true, id: created.id });
      }
      case 'department': {
        if (!branchId) return NextResponse.json({ error: '部门必须指定工区' }, { status: 400 });
        const created = await prisma.department.create({ data: { name, branchId } });
        return NextResponse.json({ success: true, id: created.id });
      }
      case 'position': {
        const created = await prisma.position.create({ data: { name } });
        return NextResponse.json({ success: true, id: created.id });
      }
      case 'jobType': {
        const created = await prisma.jobType.create({ data: { name } });
        return NextResponse.json({ success: true, id: created.id });
      }
      case 'employeeLevel': {
        const created = await prisma.employeeLevel.create({ data: { name } });
        return NextResponse.json({ success: true, id: created.id });
      }
      case 'declarationLevel': {
        const created = await prisma.declarationLevel.create({ data: { name } });
        return NextResponse.json({ success: true, id: created.id });
      }
      case 'declarationSpecialty': {
        const created = await prisma.declarationSpecialty.create({ data: { name } });
        return NextResponse.json({ success: true, id: created.id });
      }
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const field = (e.meta?.target as string[] | undefined)?.join('') ?? '';
      return NextResponse.json(
        { error: field.includes('code') ? '该编码已存在，请更换' : '名称已存在，请更换' },
        { status: 409 },
      );
    }
    console.error('POST /api/admin/organization:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = UpdateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const { entity, id, name, code } = parsed.data;

    switch (entity) {
      case 'branch':
        await prisma.branch.update({ where: { id }, data: { name, code: code || null } });
        break;
      case 'department':
        await prisma.department.update({ where: { id }, data: { name } });
        break;
      case 'position':
        await prisma.position.update({ where: { id }, data: { name } });
        break;
      case 'jobType':
        await prisma.jobType.update({ where: { id }, data: { name } });
        break;
      case 'employeeLevel':
        await prisma.employeeLevel.update({ where: { id }, data: { name } });
        break;
      case 'declarationLevel':
        await prisma.declarationLevel.update({ where: { id }, data: { name } });
        break;
      case 'declarationSpecialty':
        await prisma.declarationSpecialty.update({ where: { id }, data: { name } });
        break;
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return NextResponse.json({ error: '记录不存在' }, { status: 404 });
      if (e.code === 'P2002') {
        const field = (e.meta?.target as string[] | undefined)?.join('') ?? '';
        return NextResponse.json(
          { error: field.includes('code') ? '该编码已存在，请更换' : '名称已存在，请更换' },
          { status: 409 },
        );
      }
    }
    console.error('PUT /api/admin/organization:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = DeleteSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const { entity, id } = parsed.data;

    // 删除前检查引用，避免外键约束导致的笼统 500，并给出友好提示
    const label = ENTITY_LABEL[entity];
    if (entity === 'branch') {
      const [userCount, deptCount] = await Promise.all([
        prisma.user.count({ where: { branchId: id } }),
        prisma.department.count({ where: { branchId: id } }),
      ]);
      if (userCount > 0 || deptCount > 0) {
        const parts = [
          userCount > 0 ? `${userCount} 名用户` : '',
          deptCount > 0 ? `${deptCount} 个部门` : '',
        ].filter(Boolean).join('、');
        return NextResponse.json(
          { error: `该${label}仍关联 ${parts}，请先调整后再删除。` },
          { status: 409 },
        );
      }
      await prisma.branch.delete({ where: { id } });
      return NextResponse.json({ success: true });
    }

    const userFilter = {
      department: { departmentId: id },
      position: { positionId: id },
      jobType: { jobTypeId: id },
      employeeLevel: { employeeLevelId: id },
    } as const;
    if (entity in userFilter) {
      const userCount = await prisma.user.count({ where: userFilter[entity as keyof typeof userFilter] });
      if (userCount > 0) {
        return NextResponse.json(
          { error: `该${label}仍关联 ${userCount} 名用户，请先调整后再删除。` },
          { status: 409 },
        );
      }
    }

    if (entity === 'declarationLevel' || entity === 'declarationSpecialty') {
      const submissionCount = entity === 'declarationLevel'
        ? await prisma.submission.count({ where: { declarationLevelId: id } })
        : await prisma.submission.count({ where: { declarationSpecialtyId: id } });
      if (submissionCount > 0) {
        return NextResponse.json(
          { error: `该${label}仍关联 ${submissionCount} 份申报，请先停用或改名，不建议删除。` },
          { status: 409 },
        );
      }
    }

    switch (entity) {
      case 'department': await prisma.department.delete({ where: { id } }); break;
      case 'position': await prisma.position.delete({ where: { id } }); break;
      case 'jobType': await prisma.jobType.delete({ where: { id } }); break;
      case 'employeeLevel': await prisma.employeeLevel.delete({ where: { id } }); break;
      case 'declarationLevel': await prisma.declarationLevel.delete({ where: { id } }); break;
      case 'declarationSpecialty': await prisma.declarationSpecialty.delete({ where: { id } }); break;
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return NextResponse.json({ error: '记录不存在' }, { status: 404 });
      if (e.code === 'P2003') {
        return NextResponse.json({ error: '该项仍被引用，无法删除，请先解除关联。' }, { status: 409 });
      }
    }
    console.error('DELETE /api/admin/organization:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
