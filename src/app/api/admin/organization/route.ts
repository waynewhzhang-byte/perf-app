// 组织架构 CRUD（分公司/部门/岗位/工种/员工级别）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

const EntitySchema = z.object({
  entity: z.enum(['branch', 'department', 'position', 'jobType', 'employeeLevel']),
});

const CreateSchema = EntitySchema.extend({
  name: z.string().min(1).max(100),
  code: z.string().max(50).optional(),
  branchId: z.string().optional(),                // 仅 department
});

const DeleteSchema = EntitySchema.extend({ id: z.string() });

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const [branches, departments, positions, jobTypes, employeeLevels] = await Promise.all([
      prisma.branch.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.department.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.position.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.jobType.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.employeeLevel.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);
    return NextResponse.json({ success: true, branches, departments, positions, jobTypes, employeeLevels });
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
        const created = await prisma.branch.create({ data: { name, code } });
        return NextResponse.json({ success: true, id: created.id });
      }
      case 'department': {
        if (!branchId) return NextResponse.json({ error: '部门必须指定分公司' }, { status: 400 });
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
    }
  } catch (e) {
    console.error('POST /api/admin/organization:', e);
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
    const map = {
      branch: prisma.branch,
      department: prisma.department,
      position: prisma.position,
      jobType: prisma.jobType,
      employeeLevel: prisma.employeeLevel,
    } as const;
    // @ts-expect-error narrowed at runtime
    await map[entity].delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/organization:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
