// 管理员：按工区+年度 导出 ZIP
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildBranchYearZip } from '@/lib/export-zip';

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const branchId = url.searchParams.get('branchId');
    const year = parseInt(url.searchParams.get('year') || '', 10);
    if (!branchId || !year) return NextResponse.json({ error: '缺少参数' }, { status: 400 });

    const stream = await buildBranchYearZip(branchId, year);
    // PassThrough is a Node.js stream.Readable. Next.js 14's Node.js runtime
    // accepts it as a body but the TypeScript types expect Web ReadableStream.
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(branchId)}-${year}.zip"`,
        // Prevent caching of dynamically-generated ZIP
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (e) {
    console.error('GET /api/admin/export:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
