// 员工：拉取自己的申报 / 创建草稿 / 保存项 / 提交
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, AuthError } from '@/lib/auth';
import { sendNotice } from '@/lib/notify';
import { UpsertSchema } from '@/lib/submission-validator';
import {
  DeclarationError,
  upsertDeclaration,
  type DeclarationCommand,
} from '@/lib/declaration-workflow';

async function me() {
  const s = await getSession(false);
  if (!s) throw new AuthError('UNAUTHORIZED');
  return s;
}

export async function GET(req: Request) {
  let s;
  try { s = await me(); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: '未授权' }, { status: 401 });
    console.error('GET /api/submissions auth:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
  const templateId = new URL(req.url).searchParams.get('templateId') || undefined;
  const page = Math.max(1, Number(new URL(req.url).searchParams.get('page') ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get('pageSize') ?? 20)));

  const where = { userId: s.userId, ...(templateId ? { templateId } : {}) };
  const [list, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: { template: true, items: { include: { item: true, attachments: true, optionReviews: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.submission.count({ where }),
  ]);
  return NextResponse.json({ success: true, submissions: list, total, page, pageSize });
}

export async function POST(req: Request) {
  let s;
  try { s = await me(); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: '未授权' }, { status: 401 });
    console.error('POST /api/submissions auth:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }

  const parsed = UpsertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
  }

  const cmd: DeclarationCommand = {
    userId: s.userId,
    templateId: parsed.data.templateId,
    items: parsed.data.items,
    submit: parsed.data.submit,
    workAreaId: parsed.data.workAreaId || undefined,
    hireDate: parsed.data.hireDate || undefined,
    declarationLevelId: parsed.data.declarationLevelId || undefined,
    declarationSpecialtyId: parsed.data.declarationSpecialtyId || undefined,
  };

  try {
    const result = await prisma.$transaction((tx) => upsertDeclaration(tx, cmd));

    if (cmd.submit) {
      const suffix = result.preReviewMessages.length > 0
        ? `\n自动预审提示：${result.preReviewMessages.join('；')}`
        : '';
      sendNotice(
        result.employeeContact,
        '【绩效申报】提交成功',
        `您的申报已提交，等待一级审核。${suffix}`,
      ).catch((e) => console.error('sendNotice failed:', e));
    }

    return NextResponse.json({
      success: true,
      submissionId: result.submissionId,
      preReviewWarnings: result.preReviewMessages.length > 0 || undefined,
      preReviewMessages: result.preReviewMessages.length > 0 ? result.preReviewMessages : undefined,
      skippedItems: result.skippedItems.length > 0 ? result.skippedItems : undefined,
      unrepairedItems: result.unrepairedItems.length > 0 ? result.unrepairedItems : undefined,
    });
  } catch (e) {
    if (e instanceof DeclarationError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    console.error('POST /api/submissions:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
