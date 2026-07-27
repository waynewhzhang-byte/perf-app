export { dynamic } from '@/lib/api-route';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readFinalFactSnapshot } from '@/lib/final-fact-snapshot';
import { confirmRebuiltFinalFactSnapshot } from '@/lib/final-fact-snapshot-review';

const BodySchema = z.object({
  submissionId: z.string().trim().min(1).max(128),
  note: z.string().trim().min(2).max(500),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: '人工复核参数无效' }, { status: 400 });
    }

    const reviewedAt = new Date();
    const factSnapshot = await prisma.$transaction(async (tx) => {
      const record = await tx.performanceRecord.findUnique({
        where: { submissionId: parsed.data.submissionId },
        select: {
          id: true,
          year: true,
          archivedData: true,
        },
      });
      if (!record) throw new Error('终审档案不存在');
      const snapshot = readFinalFactSnapshot(record.archivedData);
      if (!snapshot) throw new Error('终审档案缺少可复核的事实快照');
      const reviewed = confirmRebuiltFinalFactSnapshot(snapshot, {
        reviewedAt,
        reviewedBy: session.userId,
        note: parsed.data.note,
      });
      const archivedData = {
        ...(record.archivedData as Record<string, unknown>),
        factSnapshot: reviewed,
      };
      await tx.performanceRecord.update({
        where: { id: record.id },
        data: {
          archivedData: archivedData as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.factImportLog.create({
        data: {
          year: record.year,
          kind: 'final-fact-snapshot-review',
          sourceFiles: [],
          summary: {
            submissionId: parsed.data.submissionId,
            action: 'CONFIRM_REBUILT_SNAPSHOT',
            reviewedAt: reviewedAt.toISOString(),
            note: parsed.data.note,
          },
          unmatched: {},
          createdBy: session.userId,
        },
      });
      return reviewed;
    });
    return NextResponse.json({ success: true, factSnapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : '人工复核失败';
    const status = /不存在|缺少/.test(message) ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
