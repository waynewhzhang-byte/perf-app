export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { batchComputeImportedScores } from '@/lib/imported-score-batch';

/** GET /api/admin/import/scores?year=&page=&search= — 导入事实批量绩效分表 */
export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const search = url.searchParams.get('search')?.trim() ?? '';
    const employeeNo = url.searchParams.get('employeeNo')?.trim();

    const result = await batchComputeImportedScores(prisma, year, {
      page: employeeNo ? 1 : page,
      pageSize: employeeNo ? 1 : 30,
      search: employeeNo || search || undefined,
      includeSheet: !!employeeNo,
    });

    const rows = employeeNo
      ? result.rows.filter((r) => r.employeeNo === employeeNo)
      : result.rows;

    return NextResponse.json({
      success: true,
      year: result.year,
      ticketTierMaxRaw: result.ticketTierMaxRaw,
      page,
      pageSize: employeeNo ? 1 : 30,
      total: employeeNo ? rows.length : result.total,
      note: '基于已导入基本素质、两票执行、缺陷治理事实，按《评分标准 对应表》计算；工作业绩等手工维度未含在内。',
      rows: rows.map(({ sheet, ...rest }) => ({
        ...rest,
        ...(employeeNo ? { sheet } : {}),
      })),
    });
  } catch (e) {
    console.error('GET /api/admin/import/scores:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
