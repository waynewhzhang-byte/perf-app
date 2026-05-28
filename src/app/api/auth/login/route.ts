// 双入口登录：?admin=1 走管理员入口（写 admin cookie，且必须具备 ADMIN 角色）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { signSession, setSessionCookie, getUserRoles } from '@/lib/auth';
import { getAuthConfig } from '@/lib/auth-config';
import { isRateLimited, recordAttempt, getAttemptCount, extractIP } from '@/lib/rate-limit';

const Schema = z.object({
  contact: z.string().trim().min(3),
  password: z.string().trim().min(1),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
});

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
  const isAdmin = url.searchParams.get('admin') === '1';

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 });
  }
  const { contact, password, code } = parsed.data;
  const authCfg = await getAuthConfig();

  // --- Rate limiting ---
  const ip = extractIP(req);

  // Per-IP: max 20 attempts in 15 minutes
  if (isRateLimited(`login:ip:${ip}`, 20, 15 * 60_000)) {
    return NextResponse.json({ error: '请求过于频繁，请 15 分钟后再试' }, { status: 429 });
  }
  // Per-account: max 10 attempts in 30 minutes
  if (isRateLimited(`login:contact:${contact}`, 10, 30 * 60_000)) {
    return NextResponse.json({ error: '该账号尝试次数过多，请 30 分钟后再试' }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { contact } });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    // Record failed attempts on both IP and contact dimensions
    recordAttempt(`login:ip:${ip}`, 15 * 60_000);
    recordAttempt(`login:contact:${contact}`, 30 * 60_000);

    // Progressive delay (exponential backoff) to slow down brute-force
    const failCount = getAttemptCount(`login:contact:${contact}`);
    if (failCount >= 10) {
      await new Promise((r) => setTimeout(r, 15_000)); // 15s delay
    } else if (failCount >= 5) {
      await new Promise((r) => setTimeout(r, 5_000));  // 5s delay
    } else if (failCount >= 3) {
      await new Promise((r) => setTimeout(r, 1_000));  // 1s delay
    }

    return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
  }

  if (authCfg.loginRequiresVerification) {
    if (!code) {
      return NextResponse.json({ error: '请输入登录验证码' }, { status: 400 });
    }
    const vc = await prisma.verifyCode.findFirst({
      where: { target: contact, purpose: 'LOGIN', code, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!vc || vc.expiresAt < new Date()) {
      return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
    }
    await prisma.verifyCode.update({ where: { id: vc.id }, data: { consumed: true } });
  }

  const roles = await getUserRoles(user.id);
  if (isAdmin && !roles.includes('ADMIN')) {
    return NextResponse.json({ error: '该账号无管理员权限' }, { status: 403 });
  }

  const token = await signSession({ userId: user.id, contact: user.contact, fullName: user.fullName });
  await setSessionCookie(token, isAdmin);

  return NextResponse.json({ success: true, roles });
  } catch (e) {
    console.error('POST /api/auth/login:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
