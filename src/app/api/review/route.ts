// 审核：一级 / 二级审核员对申报项逐项 通过/驳回
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession, getUserRoles } from '@/lib/auth';
import { sendNotice } from '@/lib/notify';

const Schema = z.object({
  submissionId: z.string(),
  decisions: z.array(z.object({
    submissionItemId: z.string(),
    action: z.enum(['APPROVE', 'REJECT']),
    note: z.string().optional(),
  })),
});

export async function GET(req: Request) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const roles = await getUserRoles(s.userId);
  const isL1 = roles.includes('REVIEWER_L1');
  const isL2 = roles.includes('REVIEWER_L2');
  if (!isL1 && !isL2) return NextResponse.json({ error: '无审核权限' }, { status: 403 });

  const url = new URL(req.url);
  const filter = url.searchParams.get('filter'); // "completed" → 已审核记录

  // L1 限定分公司
  const l1Scopes = isL1
    ? await prisma.userRole.findMany({ where: { userId: s.userId, role: 'REVIEWER_L1' } })
    : [];
  const branchIds = l1Scopes.map((r) => r.scopeBranchId).filter(Boolean) as string[];

  // 已审核记录：查询该审核员参与过的申报
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
    if (isL1 && branchIds.length > 0) {
      completedWhere.branchId = { in: branchIds };
    }

    const submissions = await prisma.submission.findMany({
      where: completedWhere,
      include: {
        user: true,
        items: { include: { item: true, attachments: true } },
        logs: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({ success: true, submissions, level: isL2 ? 2 : 1, filter: 'completed' });
  }

  // 待审核（默认）
  const where: any = {};
  if (isL2) {
    where.status = 'L1_APPROVED';
  } else if (isL1) {
    where.status = 'SUBMITTED';
    if (branchIds.length > 0) {
      where.branchId = { in: branchIds };
    } else {
      return NextResponse.json({ success: true, submissions: [], level: 1 });
    }
  }

  const submissions = await prisma.submission.findMany({
    where,
    include: { user: true, items: { include: { item: true, attachments: true } } },
    orderBy: { submittedAt: 'asc' },
  });
  return NextResponse.json({ success: true, submissions, level: isL2 ? 2 : 1 });
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
    include: { items: true, user: true },
  });
  if (!sub) return NextResponse.json({ error: '申报不存在' }, { status: 404 });

  // L1 审核员分支范围校验
  if (isL1) {
    const l1Scopes = await prisma.userRole.findMany({
      where: { userId: s.userId, role: 'REVIEWER_L1' },
    });
    const scopedBranchIds = l1Scopes.map((r) => r.scopeBranchId).filter(Boolean) as string[];
    if (scopedBranchIds.length === 0 || !scopedBranchIds.includes(sub.branchId!)) {
      return NextResponse.json({ error: '该申报不在您的审核范围内' }, { status: 403 });
    }
  }

  const level = sub.status === 'SUBMITTED' ? 1 : sub.status === 'L1_APPROVED' ? 2 : 0;
  if (level === 0) return NextResponse.json({ error: '当前状态不可审核' }, { status: 400 });
  if (level === 1 && !isL1) return NextResponse.json({ error: '非一级审核员' }, { status: 403 });
  if (level === 2 && !isL2) return NextResponse.json({ error: '非二级审核员' }, { status: 403 });

  const decisionMap = new Map(parsed.data.decisions.map((d) => [d.submissionItemId, d]));
  let hasReject = false;

  // 确保审核决定覆盖当前审核级别下所有待审项
  const targetStatus = level === 1 ? 'PENDING_L1' as const : 'PENDING_L2' as const;
  const pendingItems = sub.items.filter((it) => it.status === targetStatus);
  const uncoveredPending = pendingItems.filter((it) => !decisionMap.has(it.id));
  if (uncoveredPending.length > 0) {
    const titles = uncoveredPending.map((it) => it.itemId).join('、');
    return NextResponse.json({ error: `以下申报项未做出审核决定：${titles}` }, { status: 400 });
  }

  // 不允许提交对已通过项的决策（防篡改）
  const alreadyApprovedDecisions = parsed.data.decisions.filter((d) => {
    const it = sub.items.find((i) => i.id === d.submissionItemId);
    if (!it) return true; // unknown item, will fail later
    if (level === 1) return it.status === 'L1_APPROVED' || it.status === 'L2_APPROVED';
    return it.status === 'L2_APPROVED';
  });
  if (alreadyApprovedDecisions.length > 0) {
    return NextResponse.json({ error: '不能对已审核通过的申报项重复审核' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    for (const it of sub.items) {
      const d = decisionMap.get(it.id);
      if (!d) continue;
      // 跳过已通过项（L1: 跳过 L1_APPROVED / L2_APPROVED；L2: 跳过 L2_APPROVED）
      if (level === 1 && (it.status === 'L1_APPROVED' || it.status === 'L2_APPROVED')) continue;
      if (level === 2 && it.status === 'L2_APPROVED') continue;
      if (d.action === 'REJECT') hasReject = true;
      await tx.submissionItem.update({
        where: { id: it.id },
        data: {
          status: d.action === 'APPROVE'
            ? (level === 1 ? 'L1_APPROVED' : 'L2_APPROVED')
            : 'REJECTED',
          rejectReason: d.action === 'REJECT' ? (d.note ?? null) : null,
          reviewedBy: s.userId,
          reviewedAt: new Date(),
        },
      });
      await tx.reviewLog.create({
        data: {
          submissionId: sub.id, submissionItemId: it.id,
          reviewerId: s.userId, level, action: d.action, note: d.note,
        },
      });
    }

    if (hasReject) {
      await tx.submission.update({
        where: { id: sub.id },
        data: { status: 'REJECTED', ...(level === 1 ? { l1ReviewerId: s.userId, l1ReviewedAt: new Date() } : { l2ReviewerId: s.userId, l2ReviewedAt: new Date() }) },
      });
    } else if (level === 1) {
      await tx.submission.update({
        where: { id: sub.id },
        data: { status: 'L1_APPROVED', l1ReviewerId: s.userId, l1ReviewedAt: new Date() },
      });
      // 将通过项转为 PENDING_L2
      await tx.submissionItem.updateMany({
        where: { submissionId: sub.id, status: 'L1_APPROVED' },
        data: { status: 'PENDING_L2' },
      });
    } else {
      // 二级通过 → 终审
      const items = await tx.submissionItem.findMany({ where: { submissionId: sub.id, status: 'L2_APPROVED' }, include: { item: true, attachments: true } });
      const total = items.reduce((a, b) => a + Number(b.score), 0);
      await tx.submission.update({
        where: { id: sub.id },
        data: { status: 'L2_APPROVED', l2ReviewerId: s.userId, l2ReviewedAt: new Date(), totalScore: total },
      });
      // 生成年度档案
      const archived = {
        submissionId: sub.id,
        userId: sub.userId,
        templateId: sub.templateId,
        items: items.map((it) => ({
          itemId: it.itemId,
          itemTitle: it.item.title,
          selected: it.selected,
          content: it.content,
          score: it.score,
          attachments: it.attachments.map((att) => ({
            id: att.id,
            filename: att.filename,
            storageKey: att.storageKey,
            mimeType: att.mimeType,
          })),
        })),
        finalizedAt: new Date(),
      };
      const tpl = await tx.formTemplate.findUnique({ where: { id: sub.templateId } });
      await tx.performanceRecord.upsert({
        where: { userId_year: { userId: sub.userId, year: tpl?.year ?? new Date().getFullYear() } },
        update: { submissionId: sub.id, totalScore: total, archivedData: archived as any },
        create: { userId: sub.userId, year: tpl?.year ?? new Date().getFullYear(), submissionId: sub.id, totalScore: total, archivedData: archived as any },
      });
    }
  });

  // 通知员工
  sendNotice(
    sub.user.contact,
    '【绩效申报】审核结果',
    hasReject ? `您的申报有项被驳回，请登录系统修改后重新提交。` : (level === 2 ? '终审通过，已生成年度绩效档案。' : '一级审核通过，正在等待二级审核。'),
  ).catch(() => {});

  return NextResponse.json({ success: true });
}
