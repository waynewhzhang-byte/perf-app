// 审核：一级按工区整表/逐项审核，二级按申报子项所属总部部门审核
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession, getUserRoles } from '@/lib/auth';
import { sendNotice } from '@/lib/notify';
import {
  applyL1,
  applyL2,
  ReviewError,
  type ReviewOutcome,
} from '@/lib/review-workflow';
import { listAppealReviewRows } from '@/lib/appeal-review-queue';

const DecisionSchema = z.object({
  submissionItemId: z.string().optional(),
  optionReviewId: z.string().optional(),
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().optional(),
  // 申诉判断：仅对员工申诉（DISPUTED）的系统填充项生效
  disputeAction: z.enum(['APPROVE', 'REJECT']).optional(),
  disputeNote: z.string().optional(),
});

const Schema = z.object({
  submissionId: z.string(),
  decisions: z.array(DecisionSchema),
});

const BatchSchema = z.object({
  batches: z.array(Schema).min(1),
});

function noticeForOutcome(level: 1 | 2, outcome: ReviewOutcome): string | null {
  if (outcome === 'rejected') {
    return level === 1
      ? '您的申报已被一级审核驳回，请登录系统修改后重新提交。'
      : '您的申报有二级审核子项被驳回，请登录系统修改后重新提交。';
  }
  if (outcome === 'finalized') return '终审通过，已生成年度绩效档案。';
  if (level === 1) return '一级审核通过，正在等待二级审核。';
  return null;
}

export async function GET(req: Request) {
  const s = await getSession(true);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const roles = await getUserRoles(s.userId);
  const isL1 = roles.includes('REVIEWER_L1');
  const isL2 = roles.includes('REVIEWER_L2');
  if (!isL1 && !isL2) return NextResponse.json({ error: '无审核权限' }, { status: 403 });

  const url = new URL(req.url);
  const filter = url.searchParams.get('filter') === 'completed' ? 'completed' : 'pending';
  const itemTitle = url.searchParams.get('itemTitle') ?? undefined;
  const keyword = url.searchParams.get('keyword') ?? undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10)));

  const [l1Scopes, user] = await Promise.all([
    isL1 ? prisma.userRole.findMany({ where: { userId: s.userId, role: 'REVIEWER_L1' } }) : Promise.resolve([]),
    prisma.user.findUnique({ where: { id: s.userId }, select: { departmentId: true } }),
  ]);
  const departmentId = user?.departmentId ?? null;
  const level: 1 | 2 = isL2 ? 2 : 1;

  const appealList = await listAppealReviewRows(prisma, {
    level,
    reviewerId: s.userId,
    l1Scopes,
    l2DepartmentId: departmentId,
    filter,
    itemTitle,
    keyword,
    page,
    pageSize,
  });

  return NextResponse.json({
    success: true,
    level,
    filter,
    assignedDepartmentId: departmentId,
    appealRows: appealList.rows,
    total: appealList.total,
    page: appealList.page,
    pageSize: appealList.pageSize,
  });
}

export async function POST(req: Request) {
  const s = await getSession(true);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const roles = await getUserRoles(s.userId);
  const isL1 = roles.includes('REVIEWER_L1');
  const isL2 = roles.includes('REVIEWER_L2');
  if (!isL1 && !isL2) return NextResponse.json({ error: '无审核权限' }, { status: 403 });

  const body = await req.json();
  const batchParsed = BatchSchema.safeParse(body);
  if (batchParsed.success) {
    try {
      const outcomes: ReviewOutcome[] = [];
      for (const batch of batchParsed.data.batches) {
        const statusRow = await prisma.submission.findUnique({
          where: { id: batch.submissionId },
          select: { status: true },
        });
        if (!statusRow) return NextResponse.json({ error: '申报不存在' }, { status: 404 });
        const level = statusRow.status === 'SUBMITTED' ? 1 : statusRow.status === 'L1_APPROVED' ? 2 : 0;
        if (level === 0) return NextResponse.json({ error: '当前状态不可审核' }, { status: 400 });
        if (level === 1 && !isL1) return NextResponse.json({ error: '非一级审核员' }, { status: 403 });
        if (level === 2 && !isL2) return NextResponse.json({ error: '非二级审核员' }, { status: 403 });
        const result = await prisma.$transaction((tx) =>
          level === 1
            ? applyL1(tx, { submissionId: batch.submissionId, reviewerId: s.userId, decisions: batch.decisions })
            : applyL2(tx, { submissionId: batch.submissionId, reviewerId: s.userId, decisions: batch.decisions }),
        );
        outcomes.push(result.outcome);
        const notice = noticeForOutcome(level, result.outcome);
        if (notice) {
          sendNotice(result.employeeContact, '【绩效申报】审核结果', notice).catch((e) =>
            console.error('sendNotice failed:', e),
          );
        }
      }
      return NextResponse.json({ success: true, outcomes });
    } catch (e) {
      if (e instanceof ReviewError) {
        return NextResponse.json({ error: e.message }, { status: e.httpStatus });
      }
      console.error('POST /api/review batch:', e);
      return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
    }
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });

  const statusRow = await prisma.submission.findUnique({
    where: { id: parsed.data.submissionId },
    select: { status: true },
  });
  if (!statusRow) return NextResponse.json({ error: '申报不存在' }, { status: 404 });

  const level = statusRow.status === 'SUBMITTED' ? 1 : statusRow.status === 'L1_APPROVED' ? 2 : 0;
  if (level === 0) return NextResponse.json({ error: '当前状态不可审核' }, { status: 400 });
  if (level === 1 && !isL1) return NextResponse.json({ error: '非一级审核员' }, { status: 403 });
  if (level === 2 && !isL2) return NextResponse.json({ error: '非二级审核员' }, { status: 403 });

  const cmd = {
    submissionId: parsed.data.submissionId,
    reviewerId: s.userId,
    decisions: parsed.data.decisions,
  };

  try {
    const result = await prisma.$transaction((tx) =>
      level === 1 ? applyL1(tx, cmd) : applyL2(tx, cmd),
    );

    const notice = noticeForOutcome(level, result.outcome);
    if (notice) {
      sendNotice(result.employeeContact, '【绩效申报】审核结果', notice).catch((e) =>
        console.error('sendNotice failed:', e),
      );
    }

    return NextResponse.json({
      success: true,
      outcome: result.outcome,
      finalized: result.outcome === 'finalized',
      ...(result.totalScore != null ? { totalScore: result.totalScore } : {}),
    });
  } catch (e) {
    if (e instanceof ReviewError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    console.error(`POST /api/review L${level}:`, e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
