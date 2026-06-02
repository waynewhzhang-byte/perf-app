// 二级审核章节分配：将模板的章节分配给不同二级审核员（不交叉审核）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

// GET ?templateId=... → 返回该模板各章节的二级审核员分配 + 可分配的 L2 审核员列表
export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const templateId = new URL(req.url).searchParams.get('templateId');
    if (!templateId) return NextResponse.json({ error: '缺少模板 ID' }, { status: 400 });

    const sections = await prisma.formSection.findMany({
      where: { templateId },
      orderBy: { sortOrder: 'asc' },
      include: {
        reviewers: { include: { reviewer: { select: { id: true, fullName: true, contact: true } } } },
      },
    });

    // 可分配的二级审核员：拥有 REVIEWER_L2 角色的用户
    const l2Roles = await prisma.userRole.findMany({
      where: { role: 'REVIEWER_L2' },
      include: { user: { select: { id: true, fullName: true, contact: true } } },
    });
    const reviewers = l2Roles.map((r) => r.user);

    const assignments = sections.map((s) => ({
      sectionId: s.id,
      title: s.title,
      reviewers: s.reviewers.map((sr) => ({
        id: sr.reviewer.id,
        fullName: sr.reviewer.fullName,
        contact: sr.reviewer.contact,
      })),
    }));

    return NextResponse.json({ success: true, assignments, reviewers });
  } catch (e) {
    console.error('GET /api/admin/section-reviewers:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

const MutateSchema = z.object({
  action: z.enum(['add', 'remove']),
  sectionId: z.string(),
  reviewerId: z.string(),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = MutateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const { action, sectionId, reviewerId } = parsed.data;

    if (action === 'add') {
      // 校验该用户确为二级审核员
      const isL2 = await prisma.userRole.findFirst({
        where: { userId: reviewerId, role: 'REVIEWER_L2' },
      });
      if (!isL2) return NextResponse.json({ error: '该用户不是二级审核员' }, { status: 400 });

      await prisma.sectionReviewer.upsert({
        where: { sectionId_reviewerId: { sectionId, reviewerId } },
        update: {},
        create: { sectionId, reviewerId },
      });
    } else {
      await prisma.sectionReviewer.deleteMany({ where: { sectionId, reviewerId } });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      return NextResponse.json({ error: '章节或审核员不存在' }, { status: 400 });
    }
    console.error('POST /api/admin/section-reviewers:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
