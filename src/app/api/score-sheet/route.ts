export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { loadPerformanceScoreSheet } from '@/lib/performance-score-sheet';

/** GET /api/score-sheet?templateId=xxx — 员工绩效分表 */
export async function GET(req: Request) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const templateId = new URL(req.url).searchParams.get('templateId');
  if (!templateId) return NextResponse.json({ error: '缺少 templateId' }, { status: 400 });

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { year: true, title: true },
  });
  if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

  const user = await prisma.user.findUnique({
    where: { id: s.userId },
    select: { employeeNo: true },
  });
  if (!user?.employeeNo) {
    return NextResponse.json({ error: '请先完善工号信息' }, { status: 400 });
  }

  const sheet = await loadPerformanceScoreSheet({
    prisma,
    year: template.year,
    employeeNo: user.employeeNo,
    templateId,
    userId: s.userId,
  });

  if (!sheet) return NextResponse.json({ error: '无法生成分表' }, { status: 404 });

  return NextResponse.json({
    success: true,
    templateTitle: template.title,
    sheet,
  });
}
