// 管理员覆盖申诉分数：仅在申诉经 L2 确认有效后可操作
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

const OverrideSchema = z.object({
  submissionItemId: z.string(),
  overrideScore: z.number().min(0, '分数不可为负数'),
  overrideReason: z.string().min(1, '请填写覆盖原因'),
});

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const submissionId = new URL(req.url).searchParams.get('submissionId');
    if (!submissionId) return NextResponse.json({ error: '缺少 submissionId' }, { status: 400 });

    const items = await prisma.submissionItem.findMany({
      where: {
        submissionId,
        isSystemFilled: true,
        confirmationStatus: 'DISPUTED',
        disputeL2Result: 'APPROVED',
      },
      include: { item: true },
    });

    return NextResponse.json({
      success: true,
      items: items.map((it) => ({
        id: it.id,
        itemId: it.itemId,
        itemTitle: it.item.title,
        currentScore: Number(it.score),
        disputeReason: it.disputeReason,
        disputeL1Result: it.disputeL1Result,
        disputeL1Note: it.disputeL1Note,
        disputeL2Result: it.disputeL2Result,
        disputeL2Note: it.disputeL2Note,
        overrideScore: it.overrideScore ? Number(it.overrideScore) : null,
        overrideReason: it.overrideReason,
        overrideBy: it.overrideBy,
        overrideAt: it.overrideAt,
      })),
    });
  } catch (e) {
    console.error('GET /api/admin/override:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = OverrideSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const item = await prisma.submissionItem.findUnique({
      where: { id: parsed.data.submissionItemId },
      include: { submission: { include: { template: true } } },
    });
    if (!item) return NextResponse.json({ error: '申报项不存在' }, { status: 404 });
    if (!item.isSystemFilled) return NextResponse.json({ error: '仅可覆盖系统填充项' }, { status: 400 });
    if (item.confirmationStatus !== 'DISPUTED') return NextResponse.json({ error: '仅申诉项可覆盖分数' }, { status: 400 });
    if (item.disputeL2Result !== 'APPROVED') return NextResponse.json({ error: '申诉需经二级审核确认有效后方可覆盖' }, { status: 400 });
    if (item.overrideScore != null) return NextResponse.json({ error: '该申报项已被覆盖，不可重复操作' }, { status: 400 });

    const oldScore = Number(item.score);
    const newScore = parsed.data.overrideScore;

    await prisma.$transaction(async (tx) => {
      await tx.submissionItem.update({
        where: { id: item.id },
        data: {
          overrideScore: newScore,
          overrideReason: parsed.data.overrideReason,
          overrideBy: session.userId,
          overrideAt: new Date(),
          score: newScore,
        },
      });

      // 重算申报总分
      const allItems = await tx.submissionItem.findMany({
        where: { submissionId: item.submissionId },
      });
      const newTotal = allItems.reduce((sum, it) => sum + Number(it.score), 0);
      await tx.submission.update({
        where: { id: item.submissionId },
        data: { totalScore: newTotal },
      });

      // 审计日志 level=3 = 管理员覆盖分
      await tx.reviewLog.create({
        data: {
          submissionId: item.submissionId,
          submissionItemId: item.id,
          reviewerId: session.userId,
          level: 3,
          action: 'APPROVE',
          note: `管理员覆盖分：${oldScore} → ${newScore} 分，原因：${parsed.data.overrideReason}`,
        },
      });

      // 如果已有 PerformanceRecord，同步更新 totalScore
      const record = await tx.performanceRecord.findUnique({
        where: { userId_year: { userId: item.submission.userId, year: item.submission.template.year } },
      });
      if (record) {
        const archivedData = record.archivedData as Record<string, unknown> | null;
        if (archivedData && Array.isArray((archivedData as any).items)) {
          const recordItems = (archivedData as any).items as any[];
          const targetIdx = recordItems.findIndex((ri: any) => ri.itemId === item.itemId);
          if (targetIdx >= 0) {
            recordItems[targetIdx].score = newScore;
            recordItems[targetIdx].overrideScore = newScore;
            recordItems[targetIdx].overrideReason = parsed.data.overrideReason;
          }
          (archivedData as any).items = recordItems;
        }
        await tx.performanceRecord.update({
          where: { id: record.id },
          data: {
            totalScore: newTotal,
            archivedData: archivedData as any,
          },
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/admin/override:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
