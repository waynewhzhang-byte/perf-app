// 管理员报表导出：汇总 CSV / 明细汇总 CSV / 完整 ZIP / 单员工档案 ZIP（仅二审通过，支持筛选）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  buildTemplateSummaryCsv,
  buildTemplateDetailSummaryCsv,
  buildTemplateZip,
  buildEmployeeZip,
  getTemplateLabel,
  getEmployeeLabel,
  parseExportFilters,
  exportFilenameSuffix,
} from '@/lib/report-export';
import { getReviewProgress } from '@/lib/review-progress';
import { prisma } from '@/lib/prisma';
import {
  buildFinalPerformanceReportBuffer,
} from '@/lib/final-performance-report';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'csv';
    const submissionId = url.searchParams.get('submissionId');

    if (format === 'employee') {
      if (!submissionId) return NextResponse.json({ error: '缺少 submissionId' }, { status: 400 });
      const label = await getEmployeeLabel(submissionId);
      const stream = await buildEmployeeZip(submissionId);
      if (!stream || !label) {
        return NextResponse.json({ error: '未找到该员工的二审通过申报' }, { status: 404 });
      }
      const name = `${label.employeeNo ?? ''}-${label.fullName}-${label.templateTitle}-${label.year}.zip`;
      return new NextResponse(stream as unknown as ReadableStream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': contentDisposition(name),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    const parsed = parseExportFilters(url);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const filters = parsed;
    if (format === 'xlsx' || url.searchParams.get('complete') === '1') {
      const progress = await getReviewProgress(filters.templateId, filters);
      if (!progress?.complete) {
        return NextResponse.json(
          { error: '全体员工尚未完成两级审核，完整绩效报表暂不可导出', progress },
          { status: 409 },
        );
      }
    }
    const suffix = exportFilenameSuffix(filters);

    const tpl = await getTemplateLabel(filters.templateId);
    if (!tpl) return NextResponse.json({ error: '申报表不存在' }, { status: 404 });

    if (format === 'xlsx') {
      const result = await buildFinalPerformanceReportBuffer(prisma, filters);
      if (!result) {
        return NextResponse.json({ error: '申报表不存在' }, { status: 404 });
      }
      if (result.report.rows.length === 0) {
        return NextResponse.json(
          { error: '当前筛选范围暂无终审归档数据' },
          { status: 404 },
        );
      }
      const reviewSuffix = result.manualReviewCount > 0
        ? `-待人工复核${result.manualReviewCount}人`
        : '';
      const name = `${tpl.title}-${tpl.year}-最终绩效事实报表${suffix}${reviewSuffix}.xlsx`;
      return new NextResponse(new Uint8Array(result.buffer), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': contentDisposition(name),
          'Content-Length': String(result.buffer.length),
          'X-Manual-Review-Count': String(result.manualReviewCount),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    if (format === 'csv') {
      const csv = await buildTemplateSummaryCsv(filters);
      if (csv == null) return NextResponse.json({ error: '申报表不存在' }, { status: 404 });
      const name = `${tpl.title}-${tpl.year}-汇总表${suffix}.csv`;
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': contentDisposition(name),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    if (format === 'detail') {
      const csv = await buildTemplateDetailSummaryCsv(filters);
      if (csv == null) return NextResponse.json({ error: '申报表不存在' }, { status: 404 });
      const name = `${tpl.title}-${tpl.year}-明细汇总表${suffix}.csv`;
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': contentDisposition(name),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    if (format === 'zip') {
      const stream = await buildTemplateZip(filters);
      if (!stream) return NextResponse.json({ error: '申报表不存在' }, { status: 404 });
      const name = `${tpl.title}-${tpl.year}-完整档案${suffix}.zip`;
      return new NextResponse(stream as unknown as ReadableStream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': contentDisposition(name),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    return NextResponse.json({ error: '不支持的导出格式' }, { status: 400 });
  } catch (e) {
    console.error('GET /api/admin/reports/export:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
