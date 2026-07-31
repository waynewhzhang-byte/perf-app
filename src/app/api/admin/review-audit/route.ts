// 管理员审核审计：查看所有员工的审核记录、进度和结果
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { getReviewProgress } from '@/lib/review-progress';
import { resolveSubmissionDeclarationHeader } from '@/lib/submission-declaration-header';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const submissionId = url.searchParams.get('submissionId');
    const branchId = url.searchParams.get('branchId');
    const departmentId = url.searchParams.get('departmentId');
    const declarationSpecialtyId = url.searchParams.get('declarationSpecialtyId');
    const year = url.searchParams.get('year');
    const status = url.searchParams.get('status');
    const templateId = url.searchParams.get('templateId');

    // 详情模式：查看单个申报的完整报告
    if (submissionId) {
      const [submission, declarationLevels] = await Promise.all([
        prisma.submission.findUnique({
          where: { id: submissionId },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                contact: true,
                employeeNo: true,
                hireDate: true,
                profile: true,
                branch: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
                position: { select: { id: true, name: true } },
              },
            },
            template: { select: { id: true, title: true, year: true } },
            items: { include: { item: true, attachments: true } },
            logs: {
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
        prisma.declarationLevel.findMany({
          select: { id: true, name: true },
          orderBy: { sortOrder: 'asc' },
        }),
      ]);

      if (!submission) {
        return NextResponse.json({ error: '申报不存在' }, { status: 404 });
      }

      const header = resolveSubmissionDeclarationHeader(
        submission,
        submission.user,
        submission.template.year,
        declarationLevels,
      );

      // 查找对应的绩效档案
      const record = await prisma.performanceRecord.findUnique({
        where: { submissionId: submission.id },
      });

      return NextResponse.json({
        success: true,
        submission: {
          ...submission,
          hireDate: header.hireDate,
          workYears: header.workYears,
          declarationLevelId: header.declarationLevelId,
          declarationLevelName: header.declarationLevelName,
        },
        record,
      });
    }

    // 列表模式：分页查询
    const where: Record<string, unknown> = {};
    if (templateId && templateId !== 'all') where.templateId = templateId;
    if (year && year !== 'all') {
      where.template = { year: parseInt(year) };
    }
    if (status && status !== 'all') where.status = status;
    if (declarationSpecialtyId && declarationSpecialtyId !== 'all') {
      where.declarationSpecialtyId = declarationSpecialtyId;
    }
    if (branchId && branchId !== 'all') {
      where.OR = [
        { branchId },
        { branchId: null, user: { branchId } },
      ];
    }
    if (departmentId && departmentId !== 'all') {
      where.user = {
        ...((where.user as object | undefined) ?? {}),
        departmentId,
      };
    }

    const [submissions, declarationLevels] = await Promise.all([
      prisma.submission.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              contact: true,
              employeeNo: true,
              hireDate: true,
              profile: true,
              branch: { select: { id: true, name: true } },
              department: { select: { id: true, name: true } },
            },
          },
          template: { select: { id: true, title: true, year: true } },
          _count: { select: { items: true, logs: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.declarationLevel.findMany({
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const enrichedSubmissions = submissions.map((submission) => {
      const header = resolveSubmissionDeclarationHeader(
        submission,
        submission.user,
        submission.template.year,
        declarationLevels,
      );
      return {
        ...submission,
        workYears: header.workYears,
        declarationLevelName: header.declarationLevelName,
      };
    });

    // 汇总统计
    const stats = {
      total: enrichedSubmissions.length,
      draft: enrichedSubmissions.filter((s) => s.status === 'DRAFT').length,
      submitted: enrichedSubmissions.filter((s) => s.status === 'SUBMITTED').length,
      l1Approved: enrichedSubmissions.filter((s) => s.status === 'L1_APPROVED').length,
      l2Approved: enrichedSubmissions.filter((s) => s.status === 'L2_APPROVED').length,
      rejected: enrichedSubmissions.filter((s) => s.status === 'REJECTED').length,
    };

    // 获取筛选字典
    const [branches, departments, declarationSpecialties, templates] = await Promise.all([
      prisma.branch.findMany({
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.department.findMany({
        select: { id: true, name: true, branchId: true },
        orderBy: [{ branchId: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.declarationSpecialty.findMany({
        select: { id: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.formTemplate.findMany({
        where: {
          status: { in: ['PUBLISHED', 'ARCHIVED'] },
          ...(year && year !== 'all' ? { year: parseInt(year, 10) } : {}),
        },
        select: { id: true, title: true, year: true },
        orderBy: [{ year: 'desc' }, { title: 'asc' }],
      }),
    ]);
    const progressTemplate = templates.find((template) => !templateId || templateId === 'all' || template.id === templateId) ?? null;
    const progress = progressTemplate
      ? await getReviewProgress(progressTemplate.id, { branchId: branchId && branchId !== 'all' ? branchId : undefined })
      : null;

    return NextResponse.json({
      success: true,
      submissions: enrichedSubmissions,
      stats,
      branches,
      departments,
      declarationSpecialties,
      templates,
      progressTemplateId: progressTemplate?.id ?? null,
      progress,
    });
  } catch (e) {
    console.error('GET /api/admin/review-audit:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
