// 按条件列出可导出的二审通过员工（供数据导出页单人选人）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listExportCandidates, parseExportFilters } from '@/lib/report-export';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = parseExportFilters(new URL(req.url));
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const candidates = await listExportCandidates(parsed);
    return NextResponse.json({ success: true, count: candidates.length, candidates });
  } catch (e) {
    console.error('GET /api/admin/export/candidates:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
