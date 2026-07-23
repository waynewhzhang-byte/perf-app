export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import {
  DEFAULT_DECLARATION_NOTICE_TEXT,
  DEFAULT_NOTICE_SECONDS,
  getAppConfig,
} from '@/lib/app-config';

const Schema = z.object({
  supportPhone: z.string().max(64),
  noticeText: z.string().min(20).max(20000),
  noticeSeconds: z.number().int().min(0).max(300),
});

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const config = await getAppConfig();
    const row = await prisma.appConfig.findUnique({ where: { id: 1 } });
    return NextResponse.json({
      success: true,
      config,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (e) {
    console.error('GET /api/admin/app-config:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }

    const { supportPhone, noticeText, noticeSeconds } = parsed.data;
    await prisma.appConfig.upsert({
      where: { id: 1 },
      update: {
        supportPhone: supportPhone.trim(),
        noticeText: noticeText.trim(),
        noticeSeconds,
        updatedBy: session.userId,
      },
      create: {
        id: 1,
        supportPhone: supportPhone.trim(),
        noticeText: noticeText.trim() || DEFAULT_DECLARATION_NOTICE_TEXT,
        noticeSeconds: noticeSeconds > 0 ? noticeSeconds : DEFAULT_NOTICE_SECONDS,
        updatedBy: session.userId,
      },
    });

    const config = await getAppConfig();
    return NextResponse.json({ success: true, config });
  } catch (e) {
    console.error('PUT /api/admin/app-config:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
