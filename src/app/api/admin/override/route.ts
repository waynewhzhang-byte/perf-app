// 管理员覆盖申诉分数：仅在申诉经 L2 确认有效后可操作
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

const OverrideSchema = z.object({
  submissionItemId: z.string(),
  overrideScore: z.number().min(0, '分数不可为负数'),
  overrideReason: z.string().min(1, '请填写覆盖原因'),
});

export async function GET(_req: Request) {
  try {
    return NextResponse.json({ error: '最终分数不可直接覆盖，请通过申诉事实修正重新计算。' }, { status: 410 });
  } catch (e) {
    console.error('GET /api/admin/override:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(_req: Request) {
  try {
    return NextResponse.json({ error: '最终分数不可直接覆盖，请通过申诉事实修正重新计算。' }, { status: 410 });
  } catch (e) {
    console.error('POST /api/admin/override:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
