// 管理员报表分析：按表单统计已审核通过员工的分值（支持工区/能级/专业筛选）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { getReviewProgress } from '@/lib/review-progress';

function submissionWhereFromFilters(filters: {
  templateId: string;
  branchId?: string;
  declarationLevelId?: string;
  declarationSpecialtyId?: string;
}) {
  const where: Record<string, unknown> = {
    templateId: filters.templateId,
    status: 'L2_APPROVED' as const,
  };
  if (filters.declarationLevelId) where.declarationLevelId = filters.declarationLevelId;
  if (filters.declarationSpecialtyId) where.declarationSpecialtyId = filters.declarationSpecialtyId;
  if (filters.branchId) {
    where.OR = [
      { branchId: filters.branchId },
      { branchId: null, user: { branchId: filters.branchId } },
    ];
  }
  return where;
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const templateId = url.searchParams.get('templateId');
    const branchId = url.searchParams.get('branchId') || undefined;
    const declarationLevelId = url.searchParams.get('declarationLevelId') || undefined;
    const declarationSpecialtyId = url.searchParams.get('declarationSpecialtyId') || undefined;

    const templates = await prisma.formTemplate.findMany({
      where: {
        status: { in: ['PUBLISHED', 'ARCHIVED'] },
        ...(templateId ? { id: templateId } : {}),
      },
      select: { id: true, title: true, year: true },
      orderBy: [{ year: 'desc' }, { title: 'asc' }],
    });

    const [branches, declarationLevels, declarationSpecialties] = await Promise.all([
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
      prisma.declarationLevel.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.declarationSpecialty.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    ]);

    const reports = await Promise.all(templates.map(async (tpl) => {
      const filters = {
        templateId: tpl.id,
        branchId,
        declarationLevelId,
        declarationSpecialtyId,
      };
      const tplSubs = await prisma.submission.findMany({
        where: submissionWhereFromFilters(filters),
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
      const scores = tplSubs.map((s) => Number(s.totalScore));
      const branchStats = new Map<string, { unit: string; count: number; total: number }>();
      for (const sub of tplSubs) {
        const unit = sub.workAreaName || sub.user.branch?.name || '未配置工区';
        const current = branchStats.get(unit) ?? { unit, count: 0, total: 0 };
        current.count += 1;
        current.total += Number(sub.totalScore);
        branchStats.set(unit, current);
      }
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
        branchBreakdown: [...branchStats.values()]
          .map((row) => ({
            unit: row.unit,
            employeeCount: row.count,
            averageTotalScore: row.count > 0 ? row.total / row.count : 0,
          }))
          .sort((a, b) => b.employeeCount - a.employeeCount || a.unit.localeCompare(b.unit, 'zh-CN')),
        progress: await getReviewProgress(tpl.id, { branchId }),
        records: tplSubs.map((sub) => ({
          submissionId: sub.id,
          userId: sub.user.id,
          userName: sub.user.fullName,
          employeeNo: sub.user.employeeNo,
          contact: sub.user.contact,
          branch: sub.workAreaName || sub.user.branch?.name || '',
          department: sub.user.department?.name || '',
          declarationLevel: sub.declarationLevelName || '',
          declarationSpecialty: sub.declarationSpecialtyName || '',
          totalScore: Number(sub.totalScore),
          items: sub.items.map((it) => ({
            itemId: it.itemId,
            itemTitle: it.item.title,
            score: Number(it.score),
            selected: it.selected,
          })),
        })),
      };
    }));

    return NextResponse.json({
      success: true,
      templates,
      branches,
      declarationLevels,
      declarationSpecialties,
      filters: { branchId: branchId ?? null, declarationLevelId: declarationLevelId ?? null, declarationSpecialtyId: declarationSpecialtyId ?? null },
      reports,
    });
  } catch (e) {
    console.error('GET /api/admin/reports:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
