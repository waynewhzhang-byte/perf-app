// 发送验证码（注册/找回密码/登录）
export { dynamic } from '@/lib/api-route';
import { randomInt } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthConfig } from '@/lib/auth-config';
import { sendVerifyCode, getActiveChannel } from '@/lib/notify';
import { isRateLimited, recordAttempt, extractIP } from '@/lib/rate-limit';

const Schema = z.object({
  target: z.string().min(3).max(255),
  purpose: z.enum(['REGISTER', 'RESET_PASSWORD', 'LOGIN']),
});

export async function POST(req: Request) {
  try {
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效' }, { status: 400 });
    }
    const { target, purpose } = parsed.data;

    const authCfg = await getAuthConfig();
    if (purpose === 'REGISTER' && !authCfg.registerRequiresVerification) {
      return NextResponse.json({ error: '当前系统未开启注册验证码' }, { status: 400 });
    }
    if (purpose === 'RESET_PASSWORD' && !authCfg.resetRequiresVerification) {
      return NextResponse.json({ error: '当前系统未开启找回密码验证码' }, { status: 400 });
    }
    if (purpose === 'LOGIN' && !authCfg.loginRequiresVerification) {
      return NextResponse.json({ error: '当前系统未开启登录验证码' }, { status: 400 });
    }

    // --- Rate limiting ---
    const ip = extractIP(req);

    // Per-IP: max 10 requests per minute (prevents SMS/email bombing)
    if (isRateLimited(`send-code:ip:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
    }
    // Per-target: max 3 requests per 10 minutes
    if (isRateLimited(`send-code:target:${target}`, 3, 10 * 60_000)) {
      return NextResponse.json({ error: '该联系方式请求过于频繁，请稍后再试' }, { status: 429 });
    }

    const channel = await getActiveChannel();
    if (!channel) {
      return NextResponse.json({ error: '系统尚未配置通知渠道' }, { status: 503 });
    }

    // 60s 限频 (DB-backed, survives multi-instance)
    const recent = await prisma.verifyCode.findFirst({
      where: { target, purpose, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent) {
      return NextResponse.json({ error: '请求过于频繁，请 60 秒后再试' }, { status: 429 });
    }

    // Cryptographically secure random 6-digit code
    const code = String(randomInt(100000, 1000000));
    await prisma.verifyCode.create({
      data: {
        target,
        code,
        purpose,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });

    try {
      await sendVerifyCode(
        target,
        code,
        purpose === 'REGISTER' ? 'register' : purpose === 'RESET_PASSWORD' ? 'reset' : 'login',
      );
    } catch (e) {
      console.error('sendVerifyCode failed:', e);
      return NextResponse.json({ error: '验证码发送失败，请稍后再试' }, { status: 502 });
    }

    recordAttempt(`send-code:ip:${ip}`, 60_000);
    recordAttempt(`send-code:target:${target}`, 10 * 60_000);

    return NextResponse.json({ success: true, expiresIn: 300 });
  } catch (e) {
    console.error('POST /api/auth/send-code:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
