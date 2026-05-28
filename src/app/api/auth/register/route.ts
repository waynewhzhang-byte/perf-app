export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { getAuthConfig, usesStrongPassword } from '@/lib/auth-config';
import { passwordSchemaForPolicy } from '@/lib/password-policy';
import { isRateLimited, recordAttempt, extractIP } from '@/lib/rate-limit';

const BaseSchema = z.object({
  contact: z.string().trim().min(3).max(255),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
  password: z.string().trim(),
  fullName: z.string().trim().min(1).max(100),
  employeeNo: z.string().max(50).optional(),
  // Foreign-key fields: constrain length and format to prevent injection
  branchId: z.string().max(50).optional(),
  departmentId: z.string().max(50).optional(),
  positionId: z.string().max(50).optional(),
  jobTypeId: z.string().max(50).optional(),
  employeeLevelId: z.string().max(50).optional(),
});

export async function POST(req: Request) {
  try {
    // --- Rate limiting ---
    const ip = extractIP(req);

  // Per-IP: max 5 registrations per hour
  if (isRateLimited(`register:ip:${ip}`, 5, 60 * 60_000)) {
    return NextResponse.json({ error: '注册请求过于频繁，请稍后再试' }, { status: 429 });
  }

  const authCfg = await getAuthConfig();

  const parsed = BaseSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
  }
  const { contact, code, password, ...rest } = parsed.data;

  const pwdCheck = passwordSchemaForPolicy(usesStrongPassword(authCfg)).safeParse(password);
  if (!pwdCheck.success) {
    return NextResponse.json(
      { error: pwdCheck.error.issues[0]?.message ?? '密码不符合要求' },
      { status: 400 },
    );
  }

  // Per-contact: max 3 verification-code attempts per hour
  if (isRateLimited(`register:contact:${contact}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: '该联系方式注册尝试过多，请稍后再试' }, { status: 429 });
  }

  let vc: { id: string } | null = null;
  if (authCfg.registerRequiresVerification) {
    if (!code) {
      return NextResponse.json({ error: '请输入验证码' }, { status: 400 });
    }
    const row = await prisma.verifyCode.findFirst({
      where: { target: contact, purpose: 'REGISTER', code, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.expiresAt < new Date()) {
      recordAttempt(`register:contact:${contact}`, 60 * 60_000);
      return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
    }
    vc = row;
  }

  const existing = await prisma.user.findUnique({ where: { contact } });
  if (existing) {
    return NextResponse.json({ error: '该联系方式已注册' }, { status: 409 });
  }

  // Wrap in try-catch to prevent Prisma error details from leaking to the client
  let user;
  try {
    user = await prisma.user.create({
      data: {
        contact,
        passwordHash: await hashPassword(password),
        ...rest,
        roles: { create: { role: 'EMPLOYEE' } },
      },
    });
  } catch (e) {
    // Mask internal errors (e.g. FK violations from invalid IDs)
    return NextResponse.json({ error: '注册失败，请检查填写信息' }, { status: 400 });
  }

  if (vc) {
    await prisma.verifyCode.update({ where: { id: vc.id }, data: { consumed: true } });
  }

  return NextResponse.json({ success: true, userId: user.id });
  } catch (e) {
    console.error('POST /api/auth/register:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
