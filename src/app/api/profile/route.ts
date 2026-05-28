// 员工个人资料：查看与修改
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const UpdateSchema = z.object({
  branchId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  positionId: z.string().optional().nullable(),
  jobTypeId: z.string().optional().nullable(),
  employeeLevelId: z.string().optional().nullable(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        fullName: true,
        contact: true,
        employeeNo: true,
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
        jobType: { select: { id: true, name: true } },
        employeeLevel: { select: { id: true, name: true } },
      },
    });
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    // 选项数据供下拉选择
    const [branches, departments, positions, jobTypes, employeeLevels] = await Promise.all([
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
      prisma.department.findMany({ select: { id: true, name: true, branchId: true }, orderBy: { createdAt: 'asc' } }),
      prisma.position.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
      prisma.jobType.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
      prisma.employeeLevel.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
    ]);

    return NextResponse.json({
      success: true,
      user,
      options: { branches, departments, positions, jobTypes, employeeLevels },
    });
  } catch (e) {
    console.error('GET /api/profile:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const parsed = UpdateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });

    const { branchId, departmentId, positionId, jobTypeId, employeeLevelId } = parsed.data;

    await prisma.user.update({
      where: { id: session.userId },
      data: { branchId, departmentId, positionId, jobTypeId, employeeLevelId },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('PUT /api/profile:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
