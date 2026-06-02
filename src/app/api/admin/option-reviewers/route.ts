// 二级审核子项分配：将表单申报项下的每个分值子项分配给总部部门
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { optionWithFallbackId, type ScoreOptionLike } from '@/lib/form-options';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const templateId = new URL(req.url).searchParams.get('templateId');
    if (!templateId) return NextResponse.json({ error: '缺少模板 ID' }, { status: 400 });

    const [template, hq, allDepartments] = await Promise.all([
      prisma.formTemplate.findUnique({
        where: { id: templateId },
        include: {
          sections: {
            orderBy: { sortOrder: 'asc' },
            include: {
              items: {
                orderBy: { sortOrder: 'asc' },
                include: { optionReviewers: true },
              },
            },
          },
        },
      }),
      prisma.branch.findFirst({ where: { name: '公司总部' }, select: { id: true } }),
      prisma.department.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, branchId: true } }),
    ]);
    if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

    const departments = hq
      ? allDepartments.filter((department) => department.branchId === hq.id)
      : allDepartments;

    const sections = template.sections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => {
        const assignments = new Map(item.optionReviewers.map((reviewer) => [reviewer.optionId, reviewer.departmentId]));
        const options = (Array.isArray(item.scoreOptions) ? item.scoreOptions : []) as unknown as ScoreOptionLike[];
        return {
          id: item.id,
          title: item.title,
          scoreOptions: options.map((option, index) => {
            const withId = optionWithFallbackId(option, item.id, index);
            return {
              optionId: withId.optionId,
              label: withId.label,
              score: withId.score,
              departmentId: assignments.get(withId.optionId) ?? '',
            };
          }),
        };
      }),
    }));

    return NextResponse.json({ success: true, sections, departments });
  } catch (e) {
    console.error('GET /api/admin/option-reviewers:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

const MutateSchema = z.object({
  itemId: z.string(),
  optionId: z.string(),
  departmentId: z.string().nullable(),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = MutateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const { itemId, optionId, departmentId } = parsed.data;

    const item = await prisma.formItem.findUnique({ where: { id: itemId } });
    if (!item) return NextResponse.json({ error: '申报项不存在' }, { status: 404 });
    const options = (Array.isArray(item.scoreOptions) ? item.scoreOptions : []) as unknown as ScoreOptionLike[];
    const exists = options.some((option, index) => optionWithFallbackId(option, item.id, index).optionId === optionId);
    if (!exists) return NextResponse.json({ error: '申报子项不存在' }, { status: 404 });

    if (!departmentId) {
      await prisma.formOptionReviewer.deleteMany({ where: { itemId, optionId } });
      return NextResponse.json({ success: true });
    }

    const department = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) return NextResponse.json({ error: '部门不存在' }, { status: 404 });

    await prisma.formOptionReviewer.upsert({
      where: { itemId_optionId: { itemId, optionId } },
      update: { departmentId },
      create: { itemId, optionId, departmentId },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      return NextResponse.json({ error: '申报项或部门不存在' }, { status: 400 });
    }
    console.error('POST /api/admin/option-reviewers:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
