export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildRadarFromPerformanceRecord } from '@/lib/section-radar';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const record = await prisma.performanceRecord.findUnique({
      where: { id: params.id },
      select: { userId: true },
    });
    if (!record) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }
    if (record.userId !== session.userId) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    const radar = await buildRadarFromPerformanceRecord(params.id);
    if (!radar) {
      return NextResponse.json({ error: '无法生成雷达图数据' }, { status: 404 });
    }

    return NextResponse.json({ success: true, radar });
  } catch (e) {
    console.error('GET /api/records/[id]/radar:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
