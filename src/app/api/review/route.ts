// 审核：一级按工区整表/逐项审核，二级按申报子项所属总部部门审核
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession, getUserRoles } from '@/lib/auth';
import { sendNotice } from '@/lib/notify';
import { normalizeSelectedOptions, type ScoreOptionLike } from '@/lib/form-options';

const DecisionSchema = z.object({
  submissionItemId: z.string().optional(),
  optionReviewId: z.string().optional(),
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().optional(),
});

const Schema = z.object({
  submissionId: z.string(),
  overallAction: z.enum(['APPROVE', 'REJECT']).optional(),
  overallNote: z.string().optional(),
  decisions: z.array(DecisionSchema),
});

function includeFor(level: 1 | 2, departmentId?: string | null) {
  return {
    user: true,
    items: {
      include: {
        item: true,
        attachments: true,
        optionReviews: level === 2 && departmentId
          ? { where: { departmentId, status: 'PENDING_L2' as const }, include: { department: true } }
          : { include: { department: true } },
      },
    },
    logs: { orderBy: { createdAt: 'asc' as const } },
  };
}

async function archiveSubmission(tx: typeof prisma, submissionId: string, reviewerId: string) {
  const sub = await tx.submission.findUnique({
    where: { id: submissionId },
    include: {
      template: true,
      items: { include: { item: true, attachments: true, optionReviews: { include: { department: true } } } },
    },
  });
  if (!sub) return 0;
  const total = sub.items.reduce((sum, item) => sum + Number(item.score), 0);
  const archived = {
    submissionId: sub.id,
    userId: sub.userId,
    templateId: sub.templateId,
    declarationHeader: {
      workAreaId: sub.branchId,
      workAreaName: sub.workAreaName,
      hireDate: sub.hireDate,
      workYears: sub.workYears,
      declarationLevelId: sub.declarationLevelId,
      declarationLevelName: sub.declarationLevelName,
      declarationSpecialtyId: sub.declarationSpecialtyId,
      declarationSpecialtyName: sub.declarationSpecialtyName,
      preReviewPassed: sub.preReviewPassed,
      preReviewMessages: sub.preReviewMessages,
      preReviewMatchedRules: sub.preReviewMatchedRules,
    },
    items: sub.items.map((it) => ({
      itemId: it.itemId,
      itemTitle: it.item.title,
      selected: it.selected,
      content: it.content,
      score: it.score,
      optionReviews: it.optionReviews.map((review) => ({
        optionId: review.optionId,
        label: review.label,
        score: review.score,
        count: review.count,
        departmentId: review.departmentId,
        departmentName: review.department.name,
        status: review.status,
        rejectReason: review.rejectReason,
        reviewerId: review.reviewedBy,
        reviewedAt: review.reviewedAt,
      })),
      attachments: it.attachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        storageKey: att.storageKey,
        mimeType: att.mimeType,
      })),
    })),
    finalizedAt: new Date(),
  };
  await tx.submission.update({
    where: { id: sub.id },
    data: { status: 'L2_APPROVED', l2ReviewerId: reviewerId, l2ReviewedAt: new Date(), totalScore: total },
  });
  await tx.performanceRecord.upsert({
    where: { userId_year: { userId: sub.userId, year: sub.template.year } },
    update: { submissionId: sub.id, totalScore: total, archivedData: archived as any },
    create: { userId: sub.userId, year: sub.template.year, submissionId: sub.id, totalScore: total, archivedData: archived as any },
  });
  return total;
}

export async function GET(req: Request) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const roles = await getUserRoles(s.userId);
  const isL1 = roles.includes('REVIEWER_L1');
  const isL2 = roles.includes('REVIEWER_L2');
  if (!isL1 && !isL2) return NextResponse.json({ error: '无审核权限' }, { status: 403 });

  const url = new URL(req.url);
  const filter = url.searchParams.get('filter');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10)));
  const skip = (page - 1) * pageSize;

  const [l1Scopes, user] = await Promise.all([
    isL1 ? prisma.userRole.findMany({ where: { userId: s.userId, role: 'REVIEWER_L1' } }) : Promise.resolve([]),
    prisma.user.findUnique({ where: { id: s.userId }, select: { departmentId: true } }),
  ]);
  const branchIds = l1Scopes.map((r) => r.scopeBranchId).filter(Boolean) as string[];
  const departmentId = user?.departmentId ?? null;

  if (filter === 'completed') {
    const reviewedLogs = await prisma.reviewLog.findMany({
      where: { reviewerId: s.userId },
      select: { submissionId: true },
      distinct: ['submissionId'],
    });
    const reviewedIds = reviewedLogs.map((r) => r.submissionId);
    if (reviewedIds.length === 0) {
      return NextResponse.json({ success: true, submissions: [], level: isL2 ? 2 : 1, filter: 'completed' });
    }

    const completedWhere: any = { id: { in: reviewedIds } };
    if (isL1) {
      completedWhere.status = { not: 'SUBMITTED' };
      if (branchIds.length > 0) completedWhere.branchId = { in: branchIds };
    } else if (departmentId) {
      completedWhere.NOT = {
        items: { some: { optionReviews: { some: { departmentId, status: 'PENDING_L2' } } } },
      };
    }

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where: completedWhere,
        include: includeFor(1, departmentId) as any,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.submission.count({ where: completedWhere }),
    ]);
    return NextResponse.json({ success: true, submissions, level: isL2 ? 2 : 1, filter: 'completed', total, page, pageSize });
  }

  const where: any = {};
  if (isL2) {
    if (!departmentId) {
      return NextResponse.json({ success: true, submissions: [], level: 2, assignedDepartmentId: null });
    }
    where.status = 'L1_APPROVED';
    where.items = { some: { optionReviews: { some: { departmentId, status: 'PENDING_L2' } } } };
  } else {
    if (branchIds.length === 0) return NextResponse.json({ success: true, submissions: [], level: 1 });
    where.status = 'SUBMITTED';
    where.branchId = { in: branchIds };
  }

  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: includeFor(isL2 ? 2 : 1, departmentId) as any,
      orderBy: { submittedAt: 'asc' },
      skip,
      take: pageSize,
    }),
    prisma.submission.count({ where }),
  ]);
  return NextResponse.json({ success: true, submissions, level: isL2 ? 2 : 1, assignedDepartmentId: departmentId, total, page, pageSize });
}

export async function POST(req: Request) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const roles = await getUserRoles(s.userId);
  const isL1 = roles.includes('REVIEWER_L1');
  const isL2 = roles.includes('REVIEWER_L2');
  if (!isL1 && !isL2) return NextResponse.json({ error: '无审核权限' }, { status: 403 });

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });

  const sub = await prisma.submission.findUnique({
    where: { id: parsed.data.submissionId },
    include: {
      items: { include: { item: { include: { optionReviewers: true } }, optionReviews: true } },
      user: true,
    },
  });
  if (!sub) return NextResponse.json({ error: '申报不存在' }, { status: 404 });

  const level = sub.status === 'SUBMITTED' ? 1 : sub.status === 'L1_APPROVED' ? 2 : 0;
  if (level === 0) return NextResponse.json({ error: '当前状态不可审核' }, { status: 400 });
  if (level === 1 && !isL1) return NextResponse.json({ error: '非一级审核员' }, { status: 403 });
  if (level === 2 && !isL2) return NextResponse.json({ error: '非二级审核员' }, { status: 403 });

  if (level === 1) {
    const l1Scopes = await prisma.userRole.findMany({ where: { userId: s.userId, role: 'REVIEWER_L1' } });
    const scopedBranchIds = l1Scopes.map((r) => r.scopeBranchId).filter(Boolean) as string[];
    if (scopedBranchIds.length === 0 || !scopedBranchIds.includes(sub.branchId!)) {
      return NextResponse.json({ error: '该申报不在您的审核范围内' }, { status: 403 });
    }

    const overallAction = parsed.data.overallAction ?? 'APPROVE';
    if (overallAction === 'REJECT' && !parsed.data.overallNote?.trim()) {
      return NextResponse.json({ error: '整表驳回必须填写原因' }, { status: 400 });
    }
    const pendingItems = sub.items.filter((item) => item.status === 'PENDING_L1');
    const decisionMap = new Map(parsed.data.decisions.map((d) => [d.submissionItemId, d]));
    if (overallAction === 'APPROVE') {
      const uncovered = pendingItems.filter((item) => !decisionMap.has(item.id));
      if (uncovered.length > 0) {
        return NextResponse.json({ error: `以下申报项未做出审核决定：${uncovered.map((item) => item.item.title).join('、')}` }, { status: 400 });
      }
    }
    const itemReject = parsed.data.decisions.find((d) => d.action === 'REJECT' && !d.note?.trim());
    if (itemReject) return NextResponse.json({ error: '驳回的项必须填写原因' }, { status: 400 });

    let rejected = overallAction === 'REJECT';
    let finalized = false;
    try {
      await prisma.$transaction(async (tx) => {
        if (overallAction === 'REJECT') {
          await tx.submissionItem.updateMany({
            where: { submissionId: sub.id, status: 'PENDING_L1' },
            data: { status: 'REJECTED', rejectReason: parsed.data.overallNote },
          });
          await tx.reviewLog.create({
            data: { submissionId: sub.id, reviewerId: s.userId, level: 1, action: 'REJECT', note: `整表/表头驳回：${parsed.data.overallNote}` },
          });
          await tx.submission.update({
            where: { id: sub.id },
            data: { status: 'REJECTED', l1ReviewerId: s.userId, l1ReviewedAt: new Date() },
          });
          return;
        }

      for (const item of pendingItems) {
        const decision = decisionMap.get(item.id)!;
        if (decision.action === 'REJECT') rejected = true;
        await tx.submissionItem.update({
          where: { id: item.id },
          data: {
            status: decision.action === 'REJECT' ? 'REJECTED' : 'L1_APPROVED',
            rejectReason: decision.action === 'REJECT' ? decision.note ?? null : null,
            reviewedBy: s.userId,
            reviewedAt: new Date(),
          },
        });
        await tx.reviewLog.create({
          data: {
            submissionId: sub.id,
            submissionItemId: item.id,
            reviewerId: s.userId,
            level: 1,
            action: decision.action,
            note: decision.note,
          },
        });
      }

      if (rejected) {
        await tx.submission.update({
          where: { id: sub.id },
          data: { status: 'REJECTED', l1ReviewerId: s.userId, l1ReviewedAt: new Date() },
        });
        return;
      }

      await tx.submission.update({
        where: { id: sub.id },
        data: { status: 'L1_APPROVED', l1ReviewerId: s.userId, l1ReviewedAt: new Date() },
      });

      for (const item of sub.items) {
        const selected = normalizeSelectedOptions(
          item.itemId,
          (Array.isArray(item.item.scoreOptions) ? item.item.scoreOptions : []) as unknown as ScoreOptionLike[],
          Array.isArray(item.selected) ? item.selected as any[] : [],
        );
        const selectedOptionIds = new Set(selected.map((row) => row.optionId));
        await tx.submissionOptionReview.deleteMany({
          where: {
            submissionItemId: item.id,
            status: { not: 'L2_APPROVED' },
            optionId: { notIn: Array.from(selectedOptionIds) },
          },
        });
        for (const row of selected) {
          const assignment = item.item.optionReviewers.find((reviewer) => reviewer.optionId === row.optionId);
          if (!assignment) throw new ReviewError(`「${item.item.title} / ${row.label}」尚未配置二级审核部门`);
          const existing = item.optionReviews.find((review) => review.optionId === row.optionId);
          if (existing?.status === 'L2_APPROVED') continue;
          await tx.submissionOptionReview.upsert({
            where: { submissionItemId_optionId: { submissionItemId: item.id, optionId: row.optionId } },
            update: {
              label: row.label,
              score: row.score,
              count: row.count ?? null,
              departmentId: assignment.departmentId,
              status: 'PENDING_L2',
              rejectReason: null,
              reviewedBy: null,
              reviewedAt: null,
            },
            create: {
              submissionItemId: item.id,
              optionId: row.optionId,
              label: row.label,
              score: row.score,
              count: row.count ?? null,
              departmentId: assignment.departmentId,
            },
          });
        }
      }

      const items = await tx.submissionItem.findMany({
        where: { submissionId: sub.id },
        include: { optionReviews: true },
      });
      for (const item of items) {
        if (item.optionReviews.length === 0) {
          await tx.submissionItem.update({ where: { id: item.id }, data: { status: 'L2_APPROVED' } });
          continue;
        }
        const allApproved = item.optionReviews.every((review) => review.status === 'L2_APPROVED');
        await tx.submissionItem.update({
          where: { id: item.id },
          data: { status: allApproved ? 'L2_APPROVED' : 'PENDING_L2' },
        });
      }
      const remaining = await tx.submissionOptionReview.count({
        where: { submissionItem: { submissionId: sub.id }, status: 'PENDING_L2' },
      });
      if (remaining === 0) {
        await archiveSubmission(tx as any, sub.id, s.userId);
        finalized = true;
      }
      });
    } catch (e) {
      if (e instanceof ReviewError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }

    sendNotice(
      sub.user.contact,
      '【绩效申报】审核结果',
      rejected ? '您的申报已被一级审核驳回，请登录系统修改后重新提交。' : finalized ? '终审通过，已生成年度绩效档案。' : '一级审核通过，正在等待二级审核。',
    ).catch(() => {});
    return NextResponse.json({ success: true, finalized });
  }

  const reviewer = await prisma.user.findUnique({ where: { id: s.userId }, select: { departmentId: true } });
  if (!reviewer?.departmentId) return NextResponse.json({ error: '当前二级审核员未绑定部门' }, { status: 403 });

  const pendingReviews = await prisma.submissionOptionReview.findMany({
    where: {
      submissionItem: { submissionId: sub.id },
      departmentId: reviewer.departmentId,
      status: 'PENDING_L2',
    },
    include: { submissionItem: { include: { item: true } } },
  });
  if (pendingReviews.length === 0) return NextResponse.json({ error: '当前没有属于您部门的待审子项' }, { status: 400 });

  const decisionMap = new Map(parsed.data.decisions.map((d) => [d.optionReviewId, d]));
  const uncovered = pendingReviews.filter((review) => !decisionMap.has(review.id));
  if (uncovered.length > 0) {
    return NextResponse.json({ error: `以下子项未做出审核决定：${uncovered.map((review) => review.label).join('、')}` }, { status: 400 });
  }
  const rejectWithoutNote = parsed.data.decisions.find((d) => d.action === 'REJECT' && !d.note?.trim());
  if (rejectWithoutNote) return NextResponse.json({ error: '驳回的子项必须填写原因' }, { status: 400 });

  let hasReject = false;
  let l2Finalized = false;
  await prisma.$transaction(async (tx) => {
    for (const review of pendingReviews) {
      const decision = decisionMap.get(review.id)!;
      if (decision.action === 'REJECT') hasReject = true;
      await tx.submissionOptionReview.update({
        where: { id: review.id },
        data: {
          status: decision.action === 'APPROVE' ? 'L2_APPROVED' : 'REJECTED',
          rejectReason: decision.action === 'REJECT' ? decision.note ?? null : null,
          reviewedBy: s.userId,
          reviewedAt: new Date(),
        },
      });
      await tx.reviewLog.create({
        data: {
          submissionId: sub.id,
          submissionItemId: review.submissionItemId,
          reviewerId: s.userId,
          level: 2,
          action: decision.action,
          note: `子项「${review.label}」${decision.note ? `：${decision.note}` : ''}`,
        },
      });
      if (decision.action === 'REJECT') {
        await tx.submissionItem.update({
          where: { id: review.submissionItemId },
          data: { status: 'REJECTED', rejectReason: decision.note ?? null, reviewedBy: s.userId, reviewedAt: new Date() },
        });
      }
    }

    if (hasReject) {
      await tx.submission.update({
        where: { id: sub.id },
        data: { status: 'REJECTED', l2ReviewerId: s.userId, l2ReviewedAt: new Date() },
      });
      return;
    }

    const affectedItemIds = Array.from(new Set(pendingReviews.map((review) => review.submissionItemId)));
    for (const itemId of affectedItemIds) {
      const reviews = await tx.submissionOptionReview.findMany({ where: { submissionItemId: itemId } });
      if (reviews.length > 0 && reviews.every((review) => review.status === 'L2_APPROVED')) {
        await tx.submissionItem.update({
          where: { id: itemId },
          data: { status: 'L2_APPROVED', reviewedBy: s.userId, reviewedAt: new Date(), rejectReason: null },
        });
      }
    }

    const remaining = await tx.submissionOptionReview.count({
      where: { submissionItem: { submissionId: sub.id }, status: 'PENDING_L2' },
    });
    if (remaining > 0) {
      await tx.submission.update({
        where: { id: sub.id },
        data: { l2ReviewerId: s.userId, l2ReviewedAt: new Date() },
      });
      return;
    }
    await archiveSubmission(tx as any, sub.id, s.userId);
    l2Finalized = true;
  });

  const notice = hasReject
    ? '您的申报有二级审核子项被驳回，请登录系统修改后重新提交。'
    : l2Finalized
      ? '终审通过，已生成年度绩效档案。'
      : null;
  if (notice) sendNotice(sub.user.contact, '【绩效申报】审核结果', notice).catch(() => {});
  return NextResponse.json({ success: true, finalized: l2Finalized });
}

class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}
