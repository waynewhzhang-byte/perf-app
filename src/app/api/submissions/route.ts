// 员工：拉取自己的申报 / 创建草稿 / 保存项 / 提交
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession, AuthError } from '@/lib/auth';
import { sendNotice } from '@/lib/notify';

async function me() {
  const s = await getSession(false);
  if (!s) throw new AuthError('UNAUTHORIZED');
  return s;
}

export async function GET(req: Request) {
  let s;
  try { s = await me(); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: '未授权' }, { status: 401 });
    throw e;
  }
  const templateId = new URL(req.url).searchParams.get('templateId') || undefined;
  const list = await prisma.submission.findMany({
    where: { userId: s.userId, ...(templateId ? { templateId } : {}) },
    include: { template: true, items: { include: { item: true, attachments: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ success: true, submissions: list });
}

const UpsertSchema = z.object({
  templateId: z.string(),
  items: z.array(z.object({
    itemId: z.string(),
    selected: z.array(z.object({ index: z.number(), label: z.string(), score: z.number() })),
    content: z.string().optional(),
  })),
  submit: z.boolean().default(false),     // true 表示从草稿 → 提交
});

export async function POST(req: Request) {
  let s;
  try { s = await me(); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: '未授权' }, { status: 401 });
    throw e;
  }
  const parsed = UpsertSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
  const { templateId, items, submit } = parsed.data;

  // 验证模板状态：必须是 PUBLISHED
  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    include: { sections: { include: { items: true } } },
  });
  if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  if (template.status !== 'PUBLISHED') return NextResponse.json({ error: '该表单未发布，暂不可申报' }, { status: 400 });

  // 验证 items 都属于该模板
  const validItemIds = new Set<string>();
  for (const sec of template.sections) {
    for (const it of sec.items) validItemIds.add(it.id);
  }
  for (const it of items) {
    if (!validItemIds.has(it.itemId)) {
      return NextResponse.json({ error: `申报项 ${it.itemId} 不属于当前模板` }, { status: 400 });
    }
  }

  // 构建模板 items 的快速索引：itemId → requireAttachment
  const itemMeta = new Map<string, { isRequired: boolean; requireAttachment: boolean; title: string }>();
  for (const sec of template.sections) {
    for (const it of sec.items) {
      itemMeta.set(it.id, { isRequired: it.isRequired, requireAttachment: it.requireAttachment, title: it.title });
    }
  }

  const user = await prisma.user.findUnique({ where: { id: s.userId } });
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

  // 全部操作放在一个事务里，避免 TOCTOU 和部分完成
  const skippedItems: string[] = [];
  let unrepairedRejected: Array<{ itemId: string; title: string }> = [];
  let totalScore = 0;
  let submissionId = '';

  try {
    await prisma.$transaction(async (tx) => {
      // 查找或创建 submission（事务内查找避免 race）
      let sub = await tx.submission.findUnique({
        where: { userId_templateId: { userId: s.userId, templateId } },
      });

      // 状态守卫：已有申报时，只允许 DRAFT / REJECTED 状态编辑
      if (sub) {
        if (sub.status !== 'DRAFT' && sub.status !== 'REJECTED') {
          throw new EditableError(
            sub.status === 'SUBMITTED' ? '申报已提交，不可编辑' :
            sub.status === 'L1_APPROVED' ? '申报已通过一级审核，不可编辑' :
            sub.status === 'L2_APPROVED' ? '申报已终审通过，不可编辑' :
            '当前状态不可编辑'
          );
        }
      } else {
        sub = await tx.submission.create({
          data: { userId: s.userId, templateId, branchId: user.branchId, status: 'DRAFT' },
        });
      }
      submissionId = sub.id;

      // 更新 branchId（处理员工换分公司的情况）
      if (user.branchId && sub.branchId !== user.branchId) {
        await tx.submission.update({ where: { id: sub.id }, data: { branchId: user.branchId } });
        sub = { ...sub, branchId: user.branchId };
      }

      // 保存原始 submittedAt（首次提交时才设置）
      const originalSubmittedAt = sub.submittedAt;

      // 加载已存项以支持「驳回后只允许更新驳回项」
      const existing = await tx.submissionItem.findMany({ where: { submissionId: sub.id } });
      const existingMap = new Map(existing.map((e) => [e.itemId, e]));
      const lockedItemIds = new Set<string>();

      // 检测是否从 L2 驳回（存在 L2_APPROVED 项说明已经到了二审环节）
      const hasL2ApprovedItems = existing.some((it) => it.status === 'L2_APPROVED');

      if (sub.status === 'REJECTED') {
        for (const it of existing) {
          if (it.status !== 'REJECTED') lockedItemIds.add(it.itemId);
        }
      }

      // 收集未被本次 payload 覆盖的驳回项（submit 硬错误，draft 软警告）
      unrepairedRejected = [];
      if (sub.status === 'REJECTED') {
        const payloadItemIds = new Set(items.map((it) => it.itemId));
        const unrepaired = existing.filter(
          (it) => it.status === 'REJECTED' && !payloadItemIds.has(it.itemId)
        );
        unrepairedRejected = unrepaired.map((it) => ({
          itemId: it.itemId,
          title: itemMeta.get(it.itemId)?.title ?? it.itemId,
        }));
        if (submit && unrepairedRejected.length > 0) {
          const titles = unrepairedRejected.map((u) => u.title).join('、');
          throw new EditableError(`以下驳回项未重新填写：${titles}`);
        }
      }

      // 收集附件计数以便校验 requireAttachment
      let attachmentCounts: Map<string, number> | null = null;
      if (submit) {
        const allAttachments = await tx.attachment.findMany({
          where: { submissionItem: { submissionId: sub.id } },
          include: { submissionItem: true },
        });
        attachmentCounts = new Map<string, number>();
        for (const att of allAttachments) {
          const count = attachmentCounts.get(att.submissionItem.itemId) ?? 0;
          attachmentCounts.set(att.submissionItem.itemId, count + 1);
        }
      }

      // 处理每个提交项
      for (const it of items) {
        if (lockedItemIds.has(it.itemId)) {
          skippedItems.push(it.itemId);
          // 累加锁定项的分数（从 DB 读取，不用客户端数据）
          const existingItem = existingMap.get(it.itemId);
          if (existingItem) totalScore += Number(existingItem.score);
          continue;
        }

        const score = it.selected.reduce((a, b) => a + b.score, 0);
        const meta = itemMeta.get(it.itemId);

        // 提交时校验必填
        if (submit) {
          if (meta?.isRequired && it.selected.length === 0) {
            throw new EditableError(`「${meta.title}」为必填项，请选择分值`);
          }
          if (meta?.requireAttachment && it.selected.length > 0) {
            const attCount = attachmentCounts?.get(it.itemId) ?? 0;
            if (attCount === 0) {
              throw new EditableError(`「${meta.title}」要求上传证明材料`);
            }
          }
        }

        // L2 驳回后重提：修复项直接进 PENDING_L2，跳过 L1
        // 普通重提（L1 驳回或首次提交）：进 PENDING_L1
        const newStatus = submit
          ? (hasL2ApprovedItems ? 'PENDING_L2' : 'PENDING_L1')
          : 'DRAFT';
        await tx.submissionItem.upsert({
          where: { submissionId_itemId: { submissionId: sub.id, itemId: it.itemId } },
          update: { selected: it.selected as any, content: it.content, score, status: newStatus, rejectReason: null },
          create: {
            submissionId: sub.id, itemId: it.itemId,
            selected: it.selected as any, content: it.content, score, status: newStatus,
          },
        });
        totalScore += score;
      }

      if (submit) {
        // 如果是重新提交，记录 ReviewLog
        if (sub.status === 'REJECTED') {
          await tx.reviewLog.create({
            data: {
              submissionId: sub.id,
              reviewerId: s.userId,
              level: 0, // 0 表示员工重新提交
              action: 'APPROVE', // 复用枚举表示提交动作
              note: '员工重新提交',
            },
          });
        }
        // L2 驳回后重提：submission 设为 L1_APPROVED 跳过一级审核
        // 普通重提：submission 设为 SUBMITTED 进入一级审核
        const resubmitStatus = hasL2ApprovedItems ? 'L1_APPROVED' : 'SUBMITTED';
        await tx.submission.update({
          where: { id: sub.id },
          data: {
            status: resubmitStatus,
            submittedAt: originalSubmittedAt ?? new Date(), // 首次提交时间保留
            totalScore,
          },
        });
      } else {
        // 草稿保存时同步更新 submission.status 为 DRAFT
        await tx.submission.update({
          where: { id: sub.id },
          data: { status: 'DRAFT', totalScore },
        });
      }
    });
  } catch (e) {
    if (e instanceof EditableError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  if (submit) {
    sendNotice(user.contact, '【绩效申报】提交成功', '您的申报已提交，等待一级审核。').catch(() => {});
  }

  return NextResponse.json({
    success: true,
    submissionId,
    skippedItems: skippedItems.length > 0 ? skippedItems : undefined,
    unrepairedItems: unrepairedRejected.length > 0 ? unrepairedRejected : undefined,
  });
}

// 内部错误类，用于在事务中传递用户友好消息
class EditableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditableError';
  }
}
