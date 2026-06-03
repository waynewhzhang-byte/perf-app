export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildRadarFromSubmission } from '@/lib/section-radar';

export async function GET(
  _req: Request,
  { params }: { params: { submissionId: string } },
) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const radar = await buildRadarFromSubmission(params.submissionId);
    if (!radar) {
      return NextResponse.json({ error: '申报不存在或未终审通过' }, { status: 404 });
    }

    return NextResponse.json({ success: true, radar });
  } catch (e) {
    console.error('GET /api/admin/submissions/[submissionId]/radar:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
