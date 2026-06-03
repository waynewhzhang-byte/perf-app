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
    const suffix = exportFilenameSuffix(filters);

    const tpl = await getTemplateLabel(filters.templateId);
    if (!tpl) return NextResponse.json({ error: '申报表不存在' }, { status: 404 });

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
