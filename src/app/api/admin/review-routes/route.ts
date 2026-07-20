// 系统最终评分点二审路由：dimensionCode → 公司总部二审部门
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import {
  HQ_BRANCH_NAME,
  SECOND_LEVEL_REVIEW_DEPARTMENT_NAMES,
  isSecondLevelReviewDepartment,
} from '@/lib/review-departments';
import {
  isReviewableDimensionCode,
  reviewPointDefinitions,
} from '@/lib/dimension-review-routing';

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const [routes, departments] = await Promise.all([
      prisma.dimensionReviewRoute.findMany({ select: { dimensionCode: true, departmentId: true } }),
      prisma.department.findMany({
        where: {
          branch: { name: HQ_BRANCH_NAME },
          name: { in: [...SECOND_LEVEL_REVIEW_DEPARTMENT_NAMES] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    const departmentByDimension = new Map(
      routes.map((route) => [route.dimensionCode, route.departmentId]),
    );
    const points = reviewPointDefinitions().map((point) => ({
      ...point,
      departmentId: departmentByDimension.get(point.dimensionCode) ?? '',
    }));

    return NextResponse.json({
      success: true,
      points,
      departments,
      configuredCount: points.filter((point) => point.departmentId).length,
      totalCount: points.length,
    });
  } catch (error) {
    console.error('GET /api/admin/review-routes:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

const MutateSchema = z.object({
  dimensionCode: z.string().min(1),
  departmentId: z.string().nullable(),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = MutateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const { dimensionCode, departmentId } = parsed.data;
    if (!isReviewableDimensionCode(dimensionCode)) {
      return NextResponse.json({ error: '最终评分点不存在' }, { status: 404 });
    }

    if (!departmentId) {
      await prisma.dimensionReviewRoute.deleteMany({ where: { dimensionCode } });
      return NextResponse.json({ success: true });
    }

    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      include: { branch: true },
    });
    if (
      !department ||
      department.branch.name !== HQ_BRANCH_NAME ||
      !isSecondLevelReviewDepartment(department.name)
    ) {
      return NextResponse.json(
        { error: '二审部门只能选择公司组织部、公司安监部或公司运检部' },
        { status: 400 },
      );
    }

    await prisma.dimensionReviewRoute.upsert({
      where: { dimensionCode },
      update: { departmentId },
      create: { dimensionCode, departmentId },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/admin/review-routes:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
