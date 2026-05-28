// 员工查看单条绩效档案详情（含完整快照）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

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
    });

    if (!record) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }

    if (record.userId !== session.userId) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    return NextResponse.json({ success: true, record });
  } catch (e) {
    console.error('GET /api/records/[id]:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
