// 导出与 data/generated 量化积分报送表完全同口径的 XLSX。
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { buildAnnualQuantitativeReportBuffer } from '@/lib/annual-quantitative-report';
import {
  ALL_QUANTITATIVE_REPORT_UNITS,
  quantitativeReportFilename,
} from '@/lib/quantitative-report-contract';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
    const branchId = url.searchParams.get('branchId') || undefined;
    const branch = branchId
      ? await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } })
      : null;
    if (branchId && !branch) return NextResponse.json({ error: '工区不存在' }, { status: 400 });

    const unit = branch?.name ?? ALL_QUANTITATIVE_REPORT_UNITS;
    const { buffer, rows } = await buildAnnualQuantitativeReportBuffer(prisma, {
      year,
      unit,
      branchId: branch?.id,
    });
    if (rows.length === 0) return NextResponse.json({ error: '当前范围没有可导出的年度事实数据' }, { status: 404 });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(quantitativeReportFilename(unit))}`,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/reports/quantitative/export:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
