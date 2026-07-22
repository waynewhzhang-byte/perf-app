export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildAnnualQuantitativeReportBuffer } from '@/lib/annual-quantitative-report';
import {
  ALL_QUANTITATIVE_REPORT_UNITS,
  quantitativeReportFilename,
} from '@/lib/quantitative-report-contract';

const QuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(2026),
  branchId: z.union([z.literal(ALL_QUANTITATIVE_REPORT_UNITS), z.string().cuid()]),
});

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** 管理员按年度、单位导出能级评价量化积分报送表。 */
export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      year: url.searchParams.get('year') ?? undefined,
      branchId: url.searchParams.get('branchId') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: '年度或单位参数无效' }, { status: 400 });
    }

    const { year, branchId } = parsed.data;
    const branch = branchId === ALL_QUANTITATIVE_REPORT_UNITS
      ? null
      : await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
    if (branchId !== ALL_QUANTITATIVE_REPORT_UNITS && !branch) {
      return NextResponse.json({ error: '部门不存在' }, { status: 404 });
    }

    const unit = branch?.name ?? ALL_QUANTITATIVE_REPORT_UNITS;
    const { buffer, rows } = await buildAnnualQuantitativeReportBuffer(prisma, {
      year,
      unit,
      branchId: branch?.id,
    });
    if (rows.length === 0) {
      return NextResponse.json({ error: `${year}年度${unit}暂无可导出的绩效事实数据` }, { status: 404 });
    }

    const filename = quantitativeReportFilename(unit);
    // Node 22+/24 下 Buffer 泛型与 BodyInit 不兼容，用 Uint8Array 包装
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition(filename),
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('GET /api/admin/reports/quantitative-export:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
