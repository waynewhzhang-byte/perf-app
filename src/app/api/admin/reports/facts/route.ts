export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readFinalFactSnapshot } from '@/lib/final-fact-snapshot';

const QuerySchema = z.object({
  submissionId: z.string().trim().min(1).max(128),
});

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      submissionId: url.searchParams.get('submissionId') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'submissionId 参数无效' }, { status: 400 });
    }
    const { submissionId } = parsed.data;
    const record = await prisma.performanceRecord.findUnique({
      where: { submissionId },
      select: { totalScore: true, archivedData: true },
    });
    if (!record) {
      return NextResponse.json({ error: '终审归档不存在' }, { status: 404 });
    }
    const factSnapshot = readFinalFactSnapshot(record.archivedData);
    if (!factSnapshot) {
      return NextResponse.json(
        { error: '该终审归档尚未生成事实快照，请先执行归档回填' },
        { status: 409 },
      );
    }
    return NextResponse.json({
      success: true,
      finalScore: Number(record.totalScore),
      factSnapshot,
    });
  } catch (error) {
    console.error('GET /api/admin/reports/facts:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
