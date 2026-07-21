// 双入口登录：员工使用工号；?admin=1 供管理员和审核员使用独立账号密码。
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyEmployeePassword, verifyPassword } from '@/lib/password';
import { signSession, setSessionCookie, getUserRoles } from '@/lib/auth';
import { getAuthConfig } from '@/lib/auth-config';
import { isRateLimited, recordAttempt, getAttemptCount, extractIP } from '@/lib/rate-limit';

const EmployeeSchema = z.object({
  employeeNo: z.string().trim().min(1).max(50),
  password: z.string().trim().min(1),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
});

const StaffSchema = z.object({
  account: z.string().trim().min(1).max(255),
  password: z.string().trim().min(1),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
});

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const isStaff = url.searchParams.get('admin') === '1';

    const body = await req.json();
    let identifier: string;
    let password: string;
    let code: string | undefined;
    if (isStaff) {
      const parsed = StaffSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: '参数无效' }, { status: 400 });
      }
      ({ account: identifier, password, code } = parsed.data);
    } else {
      const parsed = EmployeeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: '参数无效' }, { status: 400 });
      }
      ({ employeeNo: identifier, password, code } = parsed.data);
    }
    const authCfg = await getAuthConfig();

    // --- Rate limiting ---
    const ip = extractIP(req);
    const accountRateLimitKey = `login:${isStaff ? 'staff' : 'employee'}:${identifier}`;

    // Per-IP: max 20 attempts in 15 minutes
    if (isRateLimited(`login:ip:${ip}`, 20, 15 * 60_000)) {
      return NextResponse.json({ error: '请求过于频繁，请 15 分钟后再试' }, { status: 429 });
    }
    // Per-account: max 10 attempts in 30 minutes
    if (isRateLimited(accountRateLimitKey, 10, 30 * 60_000)) {
      return NextResponse.json({ error: '该账号尝试次数过多，请 30 分钟后再试' }, { status: 429 });
    }

    const user = isStaff
      ? await prisma.user.findUnique({ where: { contact: identifier } })
      : await prisma.user.findUnique({ where: { employeeNo: identifier } });
    const passwordValid = user
      ? isStaff
        ? !!user.passwordHash && await verifyPassword(password, user.passwordHash)
        : await verifyEmployeePassword(identifier, password, user.passwordHash)
      : false;

    if (!user || !passwordValid) {
      recordAttempt(`login:ip:${ip}`, 15 * 60_000);
      recordAttempt(accountRateLimitKey, 30 * 60_000);

      // Progressive delay (exponential backoff) to slow down brute-force
      const failCount = getAttemptCount(accountRateLimitKey);
      if (failCount >= 10) {
        await new Promise((r) => setTimeout(r, 15_000));
      } else if (failCount >= 5) {
        await new Promise((r) => setTimeout(r, 5_000));
      } else if (failCount >= 3) {
        await new Promise((r) => setTimeout(r, 1_000));
      }

      return NextResponse.json({ error: isStaff ? '账号或密码错误' : '工号或密码错误' }, { status: 401 });
    }

    if (authCfg.loginRequiresVerification) {
      if (!code) {
        return NextResponse.json({ error: '请输入登录验证码' }, { status: 400 });
      }
      const vc = await prisma.verifyCode.findFirst({
        where: { target: user.contact, purpose: 'LOGIN', code, consumed: false },
        orderBy: { createdAt: 'desc' },
      });
      if (!vc || vc.expiresAt < new Date()) {
        return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
      }
      await prisma.verifyCode.update({ where: { id: vc.id }, data: { consumed: true } });
    }

    if (!isStaff && !user.passwordHash) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(identifier) },
      });
    }

    const roles = await getUserRoles(user.id);
    if (
      isStaff
      && !roles.includes('ADMIN')
      && !roles.includes('REVIEWER_L1')
      && !roles.includes('REVIEWER_L2')
    ) {
      return NextResponse.json({ error: '该账号无管理或审核权限' }, { status: 403 });
    }

    const token = await signSession({ userId: user.id, contact: user.contact, fullName: user.fullName, tokenVersion: user.tokenVersion });
    await setSessionCookie(token, isStaff);

    return NextResponse.json({ success: true, roles });
  } catch (e) {
    console.error('POST /api/auth/login:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
