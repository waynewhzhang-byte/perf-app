// 管理员配置通知渠道（短信 / 邮件）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';

const SmsSchema = z.object({
  channel: z.literal('SMS'),
  config: z.object({
    accessKeyId: z.string().min(1),
    accessKeySecret: z.string().min(1),
    signName: z.string().min(1),
    templateCode: z.string().min(1),
  }),
});

const EmailSchema = z.object({
  channel: z.literal('EMAIL'),
  config: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().min(1),
    pass: z.string().min(1),
    from: z.string().email(),
  }),
});

const Schema = z.union([SmsSchema, EmailSchema]);

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const row = await prisma.notifyConfig.findUnique({ where: { id: 1 } });
    return NextResponse.json({
      success: true,
      configured: !!row,
      channel: row?.channel ?? null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (e) {
    console.error('GET /api/admin/notify-config:', e);
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
    const { channel, config } = parsed.data;
    const cipher = encrypt(JSON.stringify(config));
    await prisma.notifyConfig.upsert({
      where: { id: 1 },
      update: { channel, configCipher: cipher, updatedBy: session.userId },
      create: { id: 1, channel, configCipher: cipher, updatedBy: session.userId },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('PUT /api/admin/notify-config:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
