// 首个超级管理员引导 - 仅在系统无 ADMIN 时可用
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { getAuthConfig, usesStrongPassword } from '@/lib/auth-config';
import { passwordSchemaForPolicy } from '@/lib/password-policy';

const Schema = z.object({
  contact: z.string().trim().min(3).max(255),
  fullName: z.string().trim().min(1).max(100),
  password: z.string().trim(),
});

class SetupError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SetupError';
    this.code = code;
  }
}

export async function GET() {
  const adminCount = await prisma.userRole.count({ where: { role: 'ADMIN' } });
  return NextResponse.json({ success: true, needSetup: adminCount === 0 });
}

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
  }
  const { contact, fullName, password } = parsed.data;
  const authCfg = await getAuthConfig();
  const pwdCheck = passwordSchemaForPolicy(usesStrongPassword(authCfg)).safeParse(password);
  if (!pwdCheck.success) {
    return NextResponse.json(
      { error: pwdCheck.error.issues[0]?.message ?? '密码不符合要求' },
      { status: 400 },
    );
  }

  // Wrap check-then-act in a transaction to prevent race conditions that
  // could create multiple ADMIN accounts via concurrent requests.
  try {
    const user = await prisma.$transaction(async (tx) => {
      const adminCount = await tx.userRole.count({ where: { role: 'ADMIN' } });
      if (adminCount > 0) {
        throw new SetupError('ADMIN_EXISTS', '系统已存在管理员，禁止重复引导');
      }

      const existing = await tx.user.findUnique({ where: { contact } });
      if (existing) {
        throw new SetupError('CONTACT_TAKEN', '该联系方式已注册');
      }

      return await tx.user.create({
        data: {
          contact,
          fullName,
          passwordHash: await hashPassword(password),
          roles: { create: { role: 'ADMIN' } },
        },
      });
    });

    return NextResponse.json({ success: true, userId: user.id });
  } catch (e: any) {
    if (e instanceof SetupError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'ADMIN_EXISTS' ? 403 : 409 });
    }
    console.error('POST /api/setup:', e);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}
