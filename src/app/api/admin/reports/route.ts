// 管理员报表分析：按表单统计已审核通过员工的分值
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const templateId = url.searchParams.get('templateId');

    const where: Record<string, unknown> = { status: 'L2_APPROVED' as const };
    if (templateId) where.templateId = templateId;

    const submissions = await prisma.submission.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            employeeNo: true,
            contact: true,
            branch: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
        template: { select: { id: true, title: true, year: true } },
        items: {
          where: { status: 'L2_APPROVED' },
          include: { item: { select: { id: true, title: true } } },
        },
      },
      orderBy: { totalScore: 'desc' },
    });

    const tplIds = [...new Set(submissions.map((s) => s.templateId))];
    const templates = await prisma.formTemplate.findMany({
      where: { id: { in: tplIds } },
      select: { id: true, title: true, year: true },
      orderBy: [{ year: 'desc' }, { title: 'asc' }],
    });

    const reports = templates.map((tpl) => {
      const tplSubs = submissions.filter((s) => s.templateId === tpl.id);
      const scores = tplSubs.map((s) => Number(s.totalScore));
      return {
        templateId: tpl.id,
        templateTitle: tpl.title,
        templateYear: tpl.year,
        stats: {
          count: tplSubs.length,
          avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
          maxScore: scores.length > 0 ? Math.max(...scores) : 0,
          minScore: scores.length > 0 ? Math.min(...scores) : 0,
        },
        records: tplSubs.map((sub) => ({
          submissionId: sub.id,
          userId: sub.user.id,
          userName: sub.user.fullName,
          employeeNo: sub.user.employeeNo,
          contact: sub.user.contact,
          branch: sub.user.branch?.name || '',
          department: sub.user.department?.name || '',
          totalScore: Number(sub.totalScore),
          items: sub.items.map((it) => ({
            itemId: it.itemId,
            itemTitle: it.item.title,
            score: Number(it.score),
            selected: it.selected,
          })),
        })),
      };
    });

    return NextResponse.json({ success: true, templates, reports });
  } catch (e) {
    console.error('GET /api/admin/reports:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
