// 管理员报表分析：按表单统计已审核通过员工的分值（支持工区/能级/专业筛选）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { getReviewProgress } from '@/lib/review-progress';
import {
  safeParseReportScopeFilters,
  reportSubmissionScopeWhere,
} from '@/lib/report-filters';
import { readFinalFactSnapshot } from '@/lib/final-fact-snapshot';

const TemplateQuerySchema = z.string().trim().min(1).max(128).optional();

function archivedItems(archivedData: unknown) {
  if (!archivedData || typeof archivedData !== 'object' || Array.isArray(archivedData)) {
    return [];
  }
  const items = (archivedData as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.itemId !== 'string' || typeof row.itemTitle !== 'string') {
      return [];
    }
    return [{
      itemId: row.itemId,
      itemTitle: row.itemTitle,
      score: Number(row.score) || 0,
      selected: row.selected,
    }];
  });
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const parsedTemplateId = TemplateQuerySchema.safeParse(
      url.searchParams.get('templateId') ?? undefined,
    );
    if (!parsedTemplateId.success) {
      return NextResponse.json({ error: 'templateId 参数无效' }, { status: 400 });
    }
    const templateId = parsedTemplateId.data;
    const parsedScope = safeParseReportScopeFilters(url.searchParams);
    if (!parsedScope.success) {
      return NextResponse.json({ error: parsedScope.error }, { status: 400 });
    }
    const scope = parsedScope.data;

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
      const tplSubs = await prisma.submission.findMany({
        where: {
          templateId: tpl.id,
          status: 'L2_APPROVED',
          ...reportSubmissionScopeWhere(scope),
        },
        include: {
          user: {
            select: {
              fullName: true,
              employeeNo: true,
              contact: true,
              branch: { select: { id: true, name: true } },
              department: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { totalScore: 'desc' },
      });
      const performanceRecords = await prisma.performanceRecord.findMany({
        where: { submissionId: { in: tplSubs.map((sub) => sub.id) } },
        select: {
          submissionId: true,
          userId: true,
          totalScore: true,
          archivedData: true,
        },
      });
      const recordBySubmission = new Map(
        performanceRecords.map((record) => [record.submissionId, record]),
      );
      const finalRows = tplSubs.flatMap((sub) => {
        const record = recordBySubmission.get(sub.id);
        if (!record) return [];
        const snapshot = readFinalFactSnapshot(record.archivedData);
        return [{
          submissionId: sub.id,
          userId: record.userId,
          userName: snapshot?.employee.employeeName ?? sub.user.fullName,
          employeeNo:
            snapshot?.employee.employeeNo ?? sub.user.employeeNo,
          contact: sub.user.contact,
          branch:
            snapshot?.employee.workAreaName
            ?? sub.workAreaName
            ?? sub.user.branch?.name
            ?? '',
          department:
            snapshot?.employee.departmentName
            ?? sub.user.department?.name
            ?? '',
          declarationLevel:
            snapshot?.employee.declarationLevelName
            ?? sub.declarationLevelName
            ?? '',
          declarationSpecialty:
            snapshot?.employee.declarationSpecialtyName
            ?? sub.declarationSpecialtyName
            ?? '',
          totalScore: Number(record.totalScore),
          items: archivedItems(record.archivedData),
        }];
      });
      const scores = finalRows.map((row) => row.totalScore);
      const branchStats = new Map<string, { unit: string; count: number; total: number }>();
      for (const row of finalRows) {
        const unit = row.branch || '未配置工区';
        const current = branchStats.get(unit) ?? { unit, count: 0, total: 0 };
        current.count += 1;
        current.total += row.totalScore;
        branchStats.set(unit, current);
      }
      return {
        templateId: tpl.id,
        templateTitle: tpl.title,
        templateYear: tpl.year,
        stats: {
          count: finalRows.length,
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
        progress: await getReviewProgress(tpl.id, scope),
        records: finalRows,
      };
    }));

    return NextResponse.json({
      success: true,
      templates,
      branches,
      declarationLevels,
      declarationSpecialties,
      filters: scope,
      reports,
    });
  } catch (e) {
    console.error('GET /api/admin/reports:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
