export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { loadPerformanceScoreSheet } from '@/lib/performance-score-sheet';
import { SCORING_STANDARDS } from '@/lib/scoring-standards';

/** GET /api/admin/score-sheet?year=&employeeNo=&templateId= */
export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
    const employeeNo = url.searchParams.get('employeeNo')?.trim();
    let templateId = url.searchParams.get('templateId')?.trim();

    if (!employeeNo) {
      return NextResponse.json({ error: '缺少 employeeNo' }, { status: 400 });
    }

    if (!templateId) {
      const tpl = await prisma.formTemplate.findFirst({
        where: { year, status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        select: { id: true },
      });
      templateId = tpl?.id;
    }
    if (!templateId) {
      return NextResponse.json({ error: '未找到该年度已发布模板' }, { status: 404 });
    }

    const sheet = await loadPerformanceScoreSheet({
      prisma,
      year,
      employeeNo,
      templateId,
    });

    if (!sheet) {
      return NextResponse.json({ error: '员工不存在或未绑定工号' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      standards: SCORING_STANDARDS,
      sheet,
    });
  } catch (e) {
    console.error('GET /api/admin/score-sheet:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
