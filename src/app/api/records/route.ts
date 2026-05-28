// 员工查询自己的绩效档案
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const records = await prisma.performanceRecord.findMany({
      where: { userId: session.userId },
      orderBy: { year: 'desc' },
      select: {
        id: true,
        year: true,
        totalScore: true,
        submissionId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, records });
  } catch (e) {
    console.error('GET /api/records:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
