export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { getAuthConfig, usesStrongPassword } from '@/lib/auth-config';
import { passwordSchemaForPolicy } from '@/lib/password-policy';
import { isRateLimited, recordAttempt, extractIP } from '@/lib/rate-limit';

const Schema = z.object({
  contact: z.string().trim().min(3),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
  newPassword: z.string().trim(),
});

export async function POST(req: Request) {
  try {
    // --- Rate limiting ---
    const ip = extractIP(req);

  // Per-IP: max 10 attempts per hour
  if (isRateLimited(`reset-password:ip:${ip}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: '重置请求过于频繁，请稍后再试' }, { status: 429 });
  }

  const authCfg = await getAuthConfig();

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
  const { contact, code, newPassword } = parsed.data;

  const pwdCheck = passwordSchemaForPolicy(usesStrongPassword(authCfg)).safeParse(newPassword);
  if (!pwdCheck.success) {
    return NextResponse.json(
      { error: pwdCheck.error.issues[0]?.message ?? '密码不符合要求' },
      { status: 400 },
    );
  }

  // Per-contact: max 5 attempts per 30 minutes
  if (isRateLimited(`reset-password:contact:${contact}`, 5, 30 * 60_000)) {
    return NextResponse.json({ error: '该账号重置尝试过多，请稍后再试' }, { status: 429 });
  }

  let vc: { id: string } | null = null;
  if (authCfg.resetRequiresVerification) {
    if (!code) {
      return NextResponse.json({ error: '请输入验证码' }, { status: 400 });
    }
    const row = await prisma.verifyCode.findFirst({
      where: { target: contact, purpose: 'RESET_PASSWORD', code, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.expiresAt < new Date()) {
      recordAttempt(`reset-password:contact:${contact}`, 30 * 60_000);
      return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
    }
    vc = row;
  }

  const user = await prisma.user.findUnique({ where: { contact } });
  if (!user) return NextResponse.json({ error: '账号不存在' }, { status: 404 });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  if (vc) {
    await prisma.verifyCode.update({ where: { id: vc.id }, data: { consumed: true } });
  }
  return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/auth/reset-password:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
