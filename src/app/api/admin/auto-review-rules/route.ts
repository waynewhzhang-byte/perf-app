// 自动预审规则 CRUD
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

const RuleBaseSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  minWorkYears: z.number().int().min(0).nullable().optional(),
  maxWorkYears: z.number().int().min(0).nullable().optional(),
  allowedLevelIds: z.array(z.string()).min(1, '至少选择一个允许申报等级'),
  rejectMessage: z.string().trim().min(1).max(500),
});

const RuleSchema = RuleBaseSchema.refine((rule) => {
  if (rule.minWorkYears == null || rule.maxWorkYears == null) return true;
  return rule.minWorkYears < rule.maxWorkYears;
}, {
  message: '工作年限下限必须小于上限',
  path: ['maxWorkYears'],
});

const UpdateRuleSchema = RuleBaseSchema.extend({ id: z.string() }).refine((rule) => {
  if (rule.minWorkYears == null || rule.maxWorkYears == null) return true;
  return rule.minWorkYears < rule.maxWorkYears;
}, {
  message: '工作年限下限必须小于上限',
  path: ['maxWorkYears'],
});

const DeleteSchema = z.object({ id: z.string() });

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const [rules, declarationLevels] = await Promise.all([
      prisma.autoReviewRule.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.declarationLevel.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true },
      }),
    ]);

    return NextResponse.json({ success: true, rules, declarationLevels });
  } catch (e) {
    console.error('GET /api/admin/auto-review-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = RuleSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }
    const { id: _id, ...data } = parsed.data;

    const created = await prisma.autoReviewRule.create({
      data: {
        ...data,
        minWorkYears: data.minWorkYears ?? null,
        maxWorkYears: data.maxWorkYears ?? null,
        allowedLevelIds: data.allowedLevelIds as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ success: true, id: created.id });
  } catch (e) {
    console.error('POST /api/admin/auto-review-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = UpdateRuleSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }
    const { id, ...data } = parsed.data;

    await prisma.autoReviewRule.update({
      where: { id },
      data: {
        ...data,
        minWorkYears: data.minWorkYears ?? null,
        maxWorkYears: data.maxWorkYears ?? null,
        allowedLevelIds: data.allowedLevelIds as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }
    console.error('PUT /api/admin/auto-review-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = DeleteSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });

    await prisma.autoReviewRule.delete({ where: { id: parsed.data.id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }
    console.error('DELETE /api/admin/auto-review-rules:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
