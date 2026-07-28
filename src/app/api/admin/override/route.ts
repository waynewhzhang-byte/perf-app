// 管理员覆盖申诉分数：仅在申诉经 L2 确认有效后可操作（按维度整项改分，不改事实台账）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { applyScoreOverride } from '@/lib/score-override';

const OverrideSchema = z.object({
  submissionItemId: z.string().min(1),
  overrideScore: z.number().finite('分数无效'),
  overrideReason: z.string().trim().min(1, '请填写覆盖原因'),
});

export async function GET() {
  return NextResponse.json(
    { error: '请使用 /api/admin/fact-corrections?submissionId=… 加载待调整申诉项' },
    { status: 410 },
  );
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = OverrideSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const result = await applyScoreOverride(prisma, {
        submissionItemId: parsed.data.submissionItemId,
        overrideScore: parsed.data.overrideScore,
        overrideReason: parsed.data.overrideReason,
        adminUserId: session.userId,
      });
      return NextResponse.json({
        success: true,
        oldScore: result.oldScore,
        newScore: result.newScore,
        totalScore: result.totalScore,
      });
    } catch (e) {
      const httpStatus = typeof e === 'object' && e && 'httpStatus' in e
        ? Number((e as { httpStatus: number }).httpStatus)
        : 500;
      const message = e instanceof Error ? e.message : '服务器内部错误';
      if (httpStatus >= 400 && httpStatus < 500) {
        return NextResponse.json({ error: message }, { status: httpStatus });
      }
      throw e;
    }
  } catch (e) {
    console.error('POST /api/admin/override:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
