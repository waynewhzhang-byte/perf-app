// 管理员审核审计：查看所有员工的审核记录、进度和结果
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const submissionId = url.searchParams.get('submissionId');
    const branchId = url.searchParams.get('branchId');
    const year = url.searchParams.get('year');
    const status = url.searchParams.get('status');

    // 详情模式：查看单个申报的完整报告
    if (submissionId) {
      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              contact: true,
              employeeNo: true,
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
      });

      if (!submission) {
        return NextResponse.json({ error: '申报不存在' }, { status: 404 });
      }

      // 查找对应的绩效档案
      const record = await prisma.performanceRecord.findUnique({
        where: { submissionId: submission.id },
      });

      return NextResponse.json({ success: true, submission, record });
    }

    // 列表模式：分页查询
    const where: any = {};
    if (branchId && branchId !== 'all') where.branchId = branchId;
    if (year && year !== 'all') {
      where.template = { year: parseInt(year) };
    }
    if (status && status !== 'all') where.status = status;

    const submissions = await prisma.submission.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            employeeNo: true,
            branch: { select: { id: true, name: true } },
          },
        },
        template: { select: { id: true, title: true, year: true } },
        _count: { select: { items: true, logs: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // 汇总统计
    const stats = {
      total: submissions.length,
      draft: submissions.filter((s) => s.status === 'DRAFT').length,
      preReviewRejected: submissions.filter((s) => s.status === 'PRE_REVIEW_REJECTED').length,
      submitted: submissions.filter((s) => s.status === 'SUBMITTED').length,
      l1Approved: submissions.filter((s) => s.status === 'L1_APPROVED').length,
      l2Approved: submissions.filter((s) => s.status === 'L2_APPROVED').length,
      rejected: submissions.filter((s) => s.status === 'REJECTED').length,
    };

    // 获取所有工区列表供筛选
    const branches = await prisma.branch.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ success: true, submissions, stats, branches });
  } catch (e) {
    console.error('GET /api/admin/review-audit:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
