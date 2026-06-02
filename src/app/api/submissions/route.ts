// 员工：拉取自己的申报 / 创建草稿 / 保存项 / 提交
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession, AuthError } from '@/lib/auth';
import { sendNotice } from '@/lib/notify';
import { calculateFullWorkYears, evaluatePreReviewRules, type PreReviewRule } from '@/lib/pre-review';
import { normalizeSelectedOptions, type ScoreOptionLike } from '@/lib/form-options';

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
    include: { template: true, items: { include: { item: true, attachments: true, optionReviews: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ success: true, submissions: list });
}

const UpsertSchema = z.object({
  templateId: z.string(),
  workAreaId: z.string().optional(),
  hireDate: z.string().optional(),
  declarationLevelId: z.string().optional(),
  declarationSpecialtyId: z.string().optional(),
  items: z.array(z.object({
    itemId: z.string(),
    selected: z.array(z.object({
      index: z.number(),
      optionId: z.string().optional(),
      label: z.string().optional(),
      score: z.number().optional(),
      count: z.number().int().min(0).optional(),  // COUNTED 模式：该子项次数
    })),
    content: z.string().optional(),
  })),
  submit: z.boolean().default(false),     // true 表示从草稿 → 提交
});

function parseDateOnly(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// 服务端权威计分：COUNTED 按 单价×次数 汇总并封顶；TIERS 累加选中分值
function computeItemScore(
  meta: { scoreMode: string; maxScore: number | null } | undefined,
  selected: Array<{ score: number; count?: number }>,
): number {
  if (meta?.scoreMode === 'COUNTED') {
    const raw = selected.reduce((sum, s) => sum + s.score * (s.count ?? 0), 0);
    const cap = meta.maxScore ?? Infinity;
    return Math.min(raw, cap);
  }
  return selected.reduce((sum, s) => sum + s.score, 0);
}

export async function POST(req: Request) {
  let s;
  try { s = await me(); } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: '未授权' }, { status: 401 });
    throw e;
  }
  const parsed = UpsertSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
  const { templateId, items, submit } = parsed.data;
  const workAreaId = parsed.data.workAreaId || undefined;
  const hireDate = parsed.data.hireDate || undefined;
  const declarationLevelId = parsed.data.declarationLevelId || undefined;
  const declarationSpecialtyId = parsed.data.declarationSpecialtyId || undefined;

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

  // 构建模板 items 的快速索引：itemId → 元数据（含计分方式与封顶）
  const itemMeta = new Map<string, { isRequired: boolean; requireAttachment: boolean; title: string; scoreMode: string; maxScore: number | null; scoreOptions: ScoreOptionLike[] }>();
  for (const sec of template.sections) {
    for (const it of sec.items) {
      itemMeta.set(it.id, {
        isRequired: it.isRequired,
        requireAttachment: it.requireAttachment,
        title: it.title,
        scoreMode: it.scoreMode,
        maxScore: it.maxScore == null ? null : Number(it.maxScore),
        scoreOptions: (Array.isArray(it.scoreOptions) ? it.scoreOptions : []) as unknown as ScoreOptionLike[],
      });
    }
  }

  const user = await prisma.user.findUnique({ where: { id: s.userId } });
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

  const parsedHireDate = parseDateOnly(hireDate);
  if (submit) {
    if (!workAreaId) return NextResponse.json({ error: '请选择工区' }, { status: 400 });
    if (!parsedHireDate) return NextResponse.json({ error: '请选择有效的入职时间' }, { status: 400 });
    if (!declarationLevelId) return NextResponse.json({ error: '请选择能级评价等级' }, { status: 400 });
    if (!declarationSpecialtyId) return NextResponse.json({ error: '请选择能级评价专业' }, { status: 400 });
  }

  // 全部操作放在一个事务里，避免 TOCTOU 和部分完成
  const skippedItems: string[] = [];
  let unrepairedRejected: Array<{ itemId: string; title: string }> = [];
  let totalScore = 0;
  let submissionId = '';
  let preReviewRejectedMessages: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      const [workArea, declarationLevel, declarationSpecialty] = await Promise.all([
        workAreaId ? tx.branch.findUnique({ where: { id: workAreaId } }) : Promise.resolve(null),
        declarationLevelId ? tx.declarationLevel.findUnique({ where: { id: declarationLevelId } }) : Promise.resolve(null),
        declarationSpecialtyId ? tx.declarationSpecialty.findUnique({ where: { id: declarationSpecialtyId } }) : Promise.resolve(null),
      ]);

      if (submit) {
        if (!workArea) throw new EditableError('请选择有效的工区');
        if (!declarationLevel) throw new EditableError('请选择有效的能级评价等级');
        if (!declarationSpecialty) throw new EditableError('请选择有效的能级评价专业');
      }

      const workYears = parsedHireDate ? calculateFullWorkYears(parsedHireDate, new Date()) : null;
      let preReview = { passed: true, messages: [] as string[], matchedRuleIds: [] as string[] };
      if (submit && parsedHireDate && declarationLevelId) {
        const dbRules = await tx.autoReviewRule.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
        const rules: PreReviewRule[] = dbRules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          minWorkYears: rule.minWorkYears,
          maxWorkYears: rule.maxWorkYears,
          allowedLevelIds: Array.isArray(rule.allowedLevelIds) ? rule.allowedLevelIds.map(String) : [],
          rejectMessage: rule.rejectMessage,
        }));
        preReview = evaluatePreReviewRules({
          workYears: workYears ?? 0,
          declarationLevelId,
          rules,
        });
        preReviewRejectedMessages = preReview.messages;
      }

      // 查找或创建 submission（事务内查找避免 race）
      let sub = await tx.submission.findUnique({
        where: { userId_templateId: { userId: s.userId, templateId } },
      });

      // 状态守卫：已有申报时，只允许 DRAFT / REJECTED / PRE_REVIEW_REJECTED 状态编辑
      if (sub) {
        if (sub.status !== 'DRAFT' && sub.status !== 'REJECTED' && sub.status !== 'PRE_REVIEW_REJECTED') {
          throw new EditableError(
            sub.status === 'SUBMITTED' ? '申报已提交，不可编辑' :
            sub.status === 'L1_APPROVED' ? '申报已通过一级审核，不可编辑' :
            sub.status === 'L2_APPROVED' ? '申报已终审通过，不可编辑' :
            '当前状态不可编辑'
          );
        }
      } else {
        sub = await tx.submission.create({
          data: { userId: s.userId, templateId, branchId: workAreaId ?? user.branchId, status: 'DRAFT' },
        });
      }
      submissionId = sub.id;

      // 保存原始 submittedAt（首次提交时才设置）
      const originalSubmittedAt = sub.submittedAt;

      // 加载已存项以支持「驳回后只允许更新驳回项」
      const existing = await tx.submissionItem.findMany({
        where: { submissionId: sub.id },
        include: { optionReviews: true },
      });
      const existingMap = new Map(existing.map((e) => [e.itemId, e]));
      const lockedItemIds = new Set<string>();


      // Lock items based on their own approval status, not the submission status.
      // This prevents previously-approved items from being overwritten when a
      // REJECTED submission is saved as draft then edited again.
      for (const it of existing) {
        if (it.status === 'L1_APPROVED' || it.status === 'L2_APPROVED') {
          lockedItemIds.add(it.itemId);
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

        const meta = itemMeta.get(it.itemId);
        if (!meta) continue;
        const existingItem = existingMap.get(it.itemId);
        const existingSelected = Array.isArray(existingItem?.selected) ? existingItem.selected as Array<{ index: number; optionId?: string; label?: string; score?: number; count?: number }> : [];
        const lockedOptionIds = new Set(
          (existingItem?.optionReviews ?? [])
            .filter((review) => review.status === 'L2_APPROVED')
            .map((review) => review.optionId),
        );
        const normalizedInput = normalizeSelectedOptions(it.itemId, meta.scoreOptions, it.selected);
        const existingSelectedByOption = new Map<string, { index: number; optionId: string; label: string; score: number; count?: number }>();
        for (const selected of existingSelected) {
          const normalizedExisting = normalizeSelectedOptions(it.itemId, meta.scoreOptions, [selected]);
          for (const row of normalizedExisting) existingSelectedByOption.set(row.optionId, row);
        }
        const selectedByOption = new Map<string, { index: number; optionId: string; label: string; score: number; count?: number }>();
        for (const row of normalizedInput) {
          selectedByOption.set(row.optionId, lockedOptionIds.has(row.optionId) ? existingSelectedByOption.get(row.optionId) ?? row : row);
        }
        for (const optionId of lockedOptionIds) {
          const locked = existingSelectedByOption.get(optionId);
          if (locked) selectedByOption.set(optionId, locked);
        }
        const normalizedSelected = Array.from(selectedByOption.values()).sort((a, b) => a.index - b.index);
        const score = computeItemScore(meta, normalizedSelected);

        // 提交时校验必填
        if (submit) {
          if (meta.isRequired && normalizedSelected.length === 0) {
            throw new EditableError(`「${meta.title}」为必填项，请选择分值`);
          }
          if (meta.requireAttachment && normalizedSelected.length > 0) {
            const attCount = attachmentCounts?.get(it.itemId) ?? 0;
            if (attCount === 0) {
              throw new EditableError(`「${meta.title}」要求上传证明材料`);
            }
          }
        }

        const newStatus = submit ? 'PENDING_L1' : 'DRAFT';
        await tx.submissionItem.upsert({
          where: { submissionId_itemId: { submissionId: sub.id, itemId: it.itemId } },
          update: { selected: normalizedSelected as any, content: it.content, score, status: newStatus, rejectReason: null },
          create: {
            submissionId: sub.id, itemId: it.itemId,
            selected: normalizedSelected as any, content: it.content, score, status: newStatus,
          },
        });
        totalScore += score;
      }

      if (submit) {
        // 如果是重新提交，记录 ReviewLog
        if (sub.status === 'REJECTED' || sub.status === 'PRE_REVIEW_REJECTED') {
          await tx.reviewLog.create({
            data: {
              submissionId: sub.id,
              reviewerId: s.userId,
              level: 0, // 0 表示员工重新提交
              action: 'APPROVE', // 复用枚举表示提交动作
              note: sub.status === 'PRE_REVIEW_REJECTED' ? '员工重新提交自动预审' : '员工重新提交',
            },
          });
        }
        if (!preReview.passed) {
          await tx.reviewLog.create({
            data: {
              submissionId: sub.id,
              reviewerId: s.userId,
              level: 0,
              action: 'REJECT',
              note: `自动预审未通过：${preReview.messages.join('；')}`,
            },
          });
        }

        await tx.submission.update({
          where: { id: sub.id },
          data: {
            branchId: workArea?.id ?? sub.branchId,
            workAreaName: workArea?.name ?? null,
            hireDate: parsedHireDate,
            workYears,
            declarationLevelId: declarationLevel?.id ?? null,
            declarationLevelName: declarationLevel?.name ?? null,
            declarationSpecialtyId: declarationSpecialty?.id ?? null,
            declarationSpecialtyName: declarationSpecialty?.name ?? null,
            preReviewPassed: preReview.passed,
            preReviewMessages: preReview.messages as any,
            preReviewMatchedRules: preReview.matchedRuleIds as any,
            status: 'SUBMITTED',
            submittedAt: originalSubmittedAt ?? new Date(),
            totalScore,
          },
        });
      } else {
        // 草稿保存时同步更新 submission.status 为 DRAFT
        await tx.submission.update({
          where: { id: sub.id },
          data: {
            branchId: workArea?.id ?? sub.branchId,
            workAreaName: workArea?.name ?? sub.workAreaName,
            hireDate: parsedHireDate,
            workYears,
            declarationLevelId: declarationLevel?.id ?? null,
            declarationLevelName: declarationLevel?.name ?? null,
            declarationSpecialtyId: declarationSpecialty?.id ?? null,
            declarationSpecialtyName: declarationSpecialty?.name ?? null,
            preReviewPassed: null,
            preReviewMessages: Prisma.DbNull,
            preReviewMatchedRules: Prisma.DbNull,
            status: 'DRAFT',
            totalScore,
          },
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
    const suffix = preReviewRejectedMessages.length > 0
      ? `\n自动预审提示：${preReviewRejectedMessages.join('；')}`
      : '';
    sendNotice(user.contact, '【绩效申报】提交成功', `您的申报已提交，等待一级审核。${suffix}`).catch(() => {});
  }

  return NextResponse.json({
    success: true,
    submissionId,
    preReviewWarnings: preReviewRejectedMessages.length > 0 || undefined,
    preReviewMessages: preReviewRejectedMessages.length > 0 ? preReviewRejectedMessages : undefined,
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
