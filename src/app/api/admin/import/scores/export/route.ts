export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { batchComputeImportedScores, summarizeImportedScoresByOrg } from '@/lib/imported-score-batch';
import { buildImportedScoresWorkbook } from '@/lib/imported-score-xlsx';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** GET /api/admin/import/scores/export?year=2025 — 导出全员导入事实绩效分表 Excel */
export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
    const format = url.searchParams.get('format') ?? 'xlsx';

    const result = await batchComputeImportedScores(prisma, year, { fetchAll: true });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: '暂无导入事实数据，请先执行基本素质导入' }, { status: 404 });
    }

    if (format === 'summary') {
      const summary = summarizeImportedScoresByOrg(result.rows);
      return NextResponse.json({
        success: true,
        year: result.year,
        total: result.total,
        ticketTierMaxRaw: result.ticketTierMaxRaw,
        ...summary,
      });
    }

    const buffer = await buildImportedScoresWorkbook(result);
    const filename = `${year}年导入事实绩效分表.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition(filename),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (e) {
    console.error('GET /api/admin/import/scores/export:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
