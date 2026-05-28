export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

const Schema = z.object({
  registerRequiresVerification: z.boolean(),
  loginRequiresVerification: z.boolean(),
  resetRequiresVerification: z.boolean(),
  enforceStrongPassword: z.boolean(),
});

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const row = await prisma.authConfig.findUnique({ where: { id: 1 } });
    return NextResponse.json({
      success: true,
      config: row
        ? {
            registerRequiresVerification: row.registerRequiresVerification,
            loginRequiresVerification: row.loginRequiresVerification,
            resetRequiresVerification: row.resetRequiresVerification,
            enforceStrongPassword: row.enforceStrongPassword,
          }
        : {
            registerRequiresVerification: true,
            loginRequiresVerification: false,
            resetRequiresVerification: true,
            enforceStrongPassword: true,
          },
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (e) {
    console.error('GET /api/admin/auth-config:', e);
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

    const data = parsed.data;
    await prisma.authConfig.upsert({
      where: { id: 1 },
      update: { ...data, updatedBy: session.userId },
      create: { id: 1, ...data, updatedBy: session.userId },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('PUT /api/admin/auth-config:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
