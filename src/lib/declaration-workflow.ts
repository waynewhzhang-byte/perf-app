/**
 * 申报 intake（Declaration intake）
 *
 * 员工草稿保存 / 提交：表头快照、系统填充确认与申诉、驳回重提锁定、预审软提示、upsert。
 * Route 开事务并传入 tx；通知在事务外由 route 根据 DeclarationResult 发送。
 *
 * 业务约束见 ADR-0003（一人一模板）、ADR-0006（预审不阻断）。
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { calculateFullWorkYears, evaluatePreReviewRules, type PreReviewRule } from '@/lib/pre-review';
import {
  declarationLevelNameCandidates,
  effectiveHireDate,
  evaluationCutoffDate,
  levelFromHireDate,
} from '@/lib/declaration-level';
import { parseDateOnly, computeItemScore } from '@/lib/submission-score';
import { finalizeAffirmSubmission } from '@/lib/review-workflow';
import { normalizeSelectedOptions, type ScoreOptionLike } from '@/lib/form-options';
import { type HeaderFieldKey, resolveHeaderFields, isFieldEnabled, isFieldRequired } from '@/lib/header-fields';
import { loadPerformanceScoreSheet } from '@/lib/performance-score-sheet';
import {
  extractSystemFilledFromSheet,
  disputedItemPersistError,
  factBoundItemIds,
  HIRE_DATE_CONFIRMATION_CODE,
  isFactDataSourceDimension,
  resolveAppealCentricConfirmation,
  submitModeCrossCheckError,
  systemItemStatusOnSubmit,
  type ConfirmationStatus,
  type SubmitMode,
} from '@/lib/system-filled-items';

export type DeclarationTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface DeclarationItemInput {
  itemId: string;
  selected: Array<{
    index: number;
    optionId?: string;
    label?: string;
    score?: number;
    count?: number;
  }>;
  content?: string;
  declaredScore?: number;
  confirmationStatus?: ConfirmationStatus | null;
  disputeReason?: string | null;
  disputeClaimedScore?: number | null;
  isSystemFilled?: boolean;
}

export interface DeclarationCommand {
  userId: string;
  templateId: string;
  items: DeclarationItemInput[];
  submit: boolean;
  submitMode?: SubmitMode;
  workAreaId?: string;
  hireDate?: string;
  declarationLevelId?: string;
  declarationSpecialtyId?: string;
}

export interface DeclarationResult {
  submissionId: string;
  totalScore: number;
  employeeContact: string;
  preReviewMessages: string[];
  skippedItems: string[];
  unrepairedItems: Array<{ itemId: string; title: string }>;
  /** submitMode=AFFIRM 时已完成归档，不进审核队列 */
  finalized?: boolean;
}

export class DeclarationError extends Error {
  constructor(
    message: string,
    readonly httpStatus: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'DeclarationError';
  }
}

/** 纯函数：已有申报是否允许编辑；不可编辑时返回用户文案 */
export function submissionEditBlockReason(status: string): string | null {
  if (status === 'DRAFT' || status === 'REJECTED') return null;
  if (status === 'SUBMITTED') return '申报已提交，不可编辑';
  if (status === 'L1_APPROVED') return '申报已通过一级审核，不可编辑';
  if (status === 'L2_APPROVED') return '申报已终审通过，不可编辑';
  return '当前状态不可编辑';
}

/** 纯函数：驳回态下未出现在本次 payload 的驳回项 */
export function findUnrepairedRejectedItems(
  existing: Array<{ itemId: string; status: string }>,
  payloadItemIds: Set<string>,
  titleOf: (itemId: string) => string,
): Array<{ itemId: string; title: string }> {
  return existing
    .filter((it) => it.status === 'REJECTED' && !payloadItemIds.has(it.itemId))
    .map((it) => ({ itemId: it.itemId, title: titleOf(it.itemId) }));
}

/**
 * 纯函数：提交时系统填充项确认/申诉校验。
 * 通过返回 null；失败返回错误文案。
 */
export function systemFilledSubmitError(input: {
  title: string;
  confirmationStatus?: ConfirmationStatus | null;
  disputeReason?: string | null;
  attachmentCount: number;
}): string | null {
  const { title, confirmationStatus, disputeReason, attachmentCount } = input;
  if (!confirmationStatus) {
    return `请对系统填充项「${title}」选择「确认」或「申诉」`;
  }
  if (confirmationStatus === 'DISPUTED') {
    if (!disputeReason?.trim()) return `请填写「${title}」的申诉理由`;
    if (attachmentCount === 0) return `「${title}」申诉须上传证明材料`;
  }
  return null;
}

type ItemMeta = {
  isRequired: boolean;
  requireAttachment: boolean;
  title: string;
  dimensionCode: string | null;
  scoreMode: string;
  maxScore: number | null;
  scoreOptions: ScoreOptionLike[];
};

export async function upsertDeclaration(
  tx: DeclarationTx,
  cmd: DeclarationCommand,
): Promise<DeclarationResult> {
  const {
    userId,
    templateId,
    items,
    submit,
    workAreaId: requestedWorkAreaId,
    hireDate,
    declarationLevelId,
    declarationSpecialtyId,
    submitMode,
  } = cmd;
  const appealCentric = !!submitMode;

  const template = await tx.formTemplate.findUnique({
    where: { id: templateId },
    include: { sections: { include: { items: true } } },
  });
  if (!template) throw new DeclarationError('模板不存在', 404);
  if (template.status !== 'PUBLISHED') {
    throw new DeclarationError('该表单未发布，暂不可申报', 400);
  }

  const hfConfig = resolveHeaderFields(template.headerFields);
  const hfEnabled = (key: HeaderFieldKey) => isFieldEnabled(hfConfig, key);
  const hfRequired = (key: HeaderFieldKey) => isFieldRequired(hfConfig, key);

  const validItemIds = new Set<string>();
  for (const sec of template.sections) {
    for (const it of sec.items) validItemIds.add(it.id);
  }
  for (const it of items) {
    if (!validItemIds.has(it.itemId)) {
      throw new DeclarationError(`申报项 ${it.itemId} 不属于当前模板`, 400);
    }
  }

  const itemMeta = new Map<string, ItemMeta>();
  for (const sec of template.sections) {
    for (const it of sec.items) {
      itemMeta.set(it.id, {
        isRequired: it.isRequired,
        requireAttachment: it.requireAttachment,
        title: it.title,
        dimensionCode: it.dimensionCode,
        scoreMode: it.scoreMode,
        maxScore: it.maxScore == null ? null : Number(it.maxScore),
        scoreOptions: (Array.isArray(it.scoreOptions) ? it.scoreOptions : []) as unknown as ScoreOptionLike[],
      });
    }
  }

  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new DeclarationError('用户不存在', 404);

  const templateItems = template.sections.flatMap((sec) => sec.items);
  const factItems = factBoundItemIds(templateItems);
  if (submit && submitMode && factItems.size > 0 && !user.employeeNo) {
    throw new DeclarationError(
      '您的账号未配置工号，无法核对系统填充分值，请联系管理员补全工号后再申报',
      400,
    );
  }

  const workAreaId = hfEnabled('workArea')
    ? requestedWorkAreaId ?? user.branchId ?? undefined
    : user.branchId ?? undefined;

  const parsedHireDate = hfEnabled('hireDate')
    ? parseDateOnly(hireDate)
    : effectiveHireDate(user.hireDate, user.profile);
  const inferredDeclarationLevelName = !hfEnabled('declarationLevel') && parsedHireDate
    ? levelFromHireDate(parsedHireDate, evaluationCutoffDate(template.year))
    : null;

  if (submit) {
    if (!workAreaId) {
      throw new DeclarationError(
        hfRequired('workArea') ? '请选择工区' : '员工未配置工区，无法提交申报',
        400,
      );
    }
    if (hfRequired('hireDate') && !parsedHireDate) {
      throw new DeclarationError('请选择有效的入职时间', 400);
    }
    if (hfRequired('declarationLevel') && !declarationLevelId) {
      throw new DeclarationError('请选择能级评价等级', 400);
    }
    if (hfRequired('declarationSpecialty') && !declarationSpecialtyId) {
      throw new DeclarationError('请选择申报专业', 400);
    }
  }

  const skippedItems: string[] = [];
  let unrepairedRejected: Array<{ itemId: string; title: string }> = [];
  let totalScore = 0;
  let preReviewMessages: string[] = [];
  let finalized = false;

  const [workArea, declarationLevel, declarationSpecialty] = await Promise.all([
    workAreaId ? tx.branch.findUnique({ where: { id: workAreaId } }) : Promise.resolve(null),
    inferredDeclarationLevelName
      ? tx.declarationLevel.findFirst({
          where: { name: { in: declarationLevelNameCandidates(inferredDeclarationLevelName) } },
          orderBy: { sortOrder: 'asc' },
        })
      : declarationLevelId
        ? tx.declarationLevel.findUnique({ where: { id: declarationLevelId } })
        : Promise.resolve(null),
    declarationSpecialtyId
      ? tx.declarationSpecialty.findUnique({ where: { id: declarationSpecialtyId } })
      : Promise.resolve(null),
  ]);

  if (submit) {
    if (hfEnabled('workArea') && !workArea) throw new DeclarationError('请选择有效的工区');
    if (hfEnabled('declarationLevel') && !declarationLevel) {
      throw new DeclarationError('请选择有效的能级评价等级');
    }
    if (hfEnabled('declarationSpecialty') && !declarationSpecialty) {
      throw new DeclarationError('请选择有效的申报专业');
    }
  }

  const workYears = parsedHireDate
    ? calculateFullWorkYears(parsedHireDate, evaluationCutoffDate(template.year))
    : null;
  let preReview = { passed: true, messages: [] as string[], matchedRuleIds: [] as string[] };
  if (submit && parsedHireDate && declarationLevel) {
    const dbRules = await tx.autoReviewRule.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    const rules: PreReviewRule[] = dbRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      minWorkYears: rule.minWorkYears,
      maxWorkYears: rule.maxWorkYears,
      allowedLevelIds: Array.isArray(rule.allowedLevelIds)
        ? rule.allowedLevelIds.map(String)
        : [],
      rejectMessage: rule.rejectMessage,
    }));
    preReview = evaluatePreReviewRules({
      workYears: workYears ?? 0,
      declarationLevelId: declarationLevel.id,
      rules,
    });
    preReviewMessages = preReview.messages;
  }

  let sub = await tx.submission.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });

  if (sub) {
    const block = submissionEditBlockReason(sub.status);
    if (block) throw new DeclarationError(block);
  } else {
    sub = await tx.submission.create({
      data: {
        userId,
        templateId,
        branchId: workAreaId ?? user.branchId,
        status: 'DRAFT',
      },
    });
  }
  const submissionId = sub.id;
  const originalSubmittedAt = sub.submittedAt;

  const existing = await tx.submissionItem.findMany({
    where: { submissionId: sub.id },
    include: { optionReviews: true },
  });
  const existingMap = new Map(existing.map((e) => [e.itemId, e]));
  const lockedItemIds = new Set<string>();

  for (const it of existing) {
    if (it.status === 'L1_APPROVED' || it.status === 'L2_APPROVED') {
      lockedItemIds.add(it.itemId);
    }
    if (it.isSystemFilled && it.confirmationStatus === 'CONFIRMED') {
      lockedItemIds.add(it.itemId);
    }
  }

  unrepairedRejected = [];
  if (sub.status === 'REJECTED') {
    unrepairedRejected = findUnrepairedRejectedItems(
      existing,
      new Set(items.map((it) => it.itemId)),
      (itemId) => itemMeta.get(itemId)?.title ?? itemId,
    );
    if (submit && unrepairedRejected.length > 0) {
      const titles = unrepairedRejected.map((u) => u.title).join('、');
      throw new DeclarationError(`以下驳回项未重新填写：${titles}`);
    }
  }

  let attachmentCounts: Map<string, number> | null = null;
  if (submit || items.some((it) => it.confirmationStatus === 'DISPUTED') || appealCentric) {
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

  const itemTitleById = new Map<string, string>();
  for (const sec of template.sections) {
    for (const it of sec.items) itemTitleById.set(it.id, it.title);
  }

  const systemFilledIds = new Set<string>();

  if (user.employeeNo) {
    const sheet = await loadPerformanceScoreSheet({
      prisma: tx as unknown as PrismaClient,
      year: template.year,
      employeeNo: user.employeeNo,
      templateId,
      userId,
    });
    if (sheet) {
      const systemItems = extractSystemFilledFromSheet(sheet);
      const hireDateItem = template.sections
        .flatMap((section) => section.items)
        .find((item) => item.dimensionCode === HIRE_DATE_CONFIRMATION_CODE);
      if (hireDateItem) {
        systemItems.unshift({
          itemId: hireDateItem.id,
          dimensionCode: HIRE_DATE_CONFIRMATION_CODE,
          title: hireDateItem.title,
          score: 0,
          ruleSummary: '参加工作时间来自员工花名册；系统据此计算工龄和参评能级。',
          selected: parsedHireDate
            ? [{
                index: 0,
                label: `参加工作时间：${parsedHireDate.toISOString().slice(0, 10)}`,
                score: 0,
              }]
            : [],
        });
      }
      for (const sys of systemItems) {
        systemFilledIds.add(sys.itemId);
      }

      const activeSystemItems = systemItems.filter((sys) => !lockedItemIds.has(sys.itemId));
      const hasDisputedSystemItems = activeSystemItems.some((sys) => {
        if (sys.dimensionCode === HIRE_DATE_CONFIRMATION_CODE) return false;
        const payload = items.find((i) => i.itemId === sys.itemId);
        const existingItem = existingMap.get(sys.itemId);
        const raw = (
          payload && 'confirmationStatus' in payload
            ? payload.confirmationStatus
            : existingItem?.confirmationStatus
        ) as ConfirmationStatus | null | undefined;
        return raw === 'DISPUTED';
      });

      if (submit && submitMode) {
        const crossErr = submitModeCrossCheckError(submitMode, hasDisputedSystemItems);
        if (crossErr) throw new DeclarationError(crossErr);
      }

      for (const sys of systemItems) {
        if (lockedItemIds.has(sys.itemId)) {
          const existingItem = existingMap.get(sys.itemId);
          if (existingItem) totalScore += Number(existingItem.score);
          continue;
        }

        const payload = items.find((i) => i.itemId === sys.itemId);
        const existingItem = existingMap.get(sys.itemId);
        const payloadIncludesStatus = Boolean(payload && 'confirmationStatus' in payload);
        let confStatus = appealCentric && submitMode
          ? resolveAppealCentricConfirmation({
              submit,
              submitMode,
              payloadStatus: payloadIncludesStatus
                ? (payload!.confirmationStatus as ConfirmationStatus | null | undefined) ?? null
                : undefined,
              existingStatus: existingItem?.confirmationStatus as ConfirmationStatus | null | undefined,
              payloadIncludesStatus,
            })
          : ((
              payload && 'confirmationStatus' in payload
                ? payload.confirmationStatus
                : existingItem?.confirmationStatus
            ) as ConfirmationStatus | null | undefined);
        // 参加工作时间只读：不可申诉，提交时自动确认；据此计算的能级在填报页明确展示。
        if (sys.dimensionCode === HIRE_DATE_CONFIRMATION_CODE) {
          if (confStatus === 'DISPUTED') {
            throw new DeclarationError('「参加工作时间」不可申诉，系统据此自动计算参评能级');
          }
          if (submit || appealCentric) {
            confStatus = 'CONFIRMED';
          }
        }
        const disputeReason = confStatus === 'DISPUTED'
          ? payload?.disputeReason ?? existingItem?.disputeReason ?? null
          : null;
        const disputeClaimedScore = confStatus === 'DISPUTED'
          ? payload?.disputeClaimedScore ?? (
              existingItem?.disputeClaimedScore != null
                ? Number(existingItem.disputeClaimedScore)
                : null
            )
          : null;
        const title = itemTitleById.get(sys.itemId) ?? sys.title;

        if (appealCentric && confStatus === 'DISPUTED') {
          const err = disputedItemPersistError({
            title,
            disputeReason,
            disputeClaimedScore,
            attachmentCount: attachmentCounts?.get(sys.itemId) ?? 0,
          });
          if (err) throw new DeclarationError(err);
        } else if (submit) {
          const err = systemFilledSubmitError({
            title,
            confirmationStatus: confStatus,
            disputeReason,
            attachmentCount: attachmentCounts?.get(sys.itemId) ?? 0,
          });
          if (err) throw new DeclarationError(err);
        }

        const itemStatus = systemItemStatusOnSubmit(submit, confStatus ?? null);

        await tx.submissionItem.upsert({
          where: { submissionId_itemId: { submissionId: sub.id, itemId: sys.itemId } },
          update: {
            selected: sys.selected as Prisma.InputJsonValue,
            score: sys.score,
            status: itemStatus,
            isSystemFilled: true,
            confirmationStatus: confStatus ?? null,
            disputeReason,
            disputeClaimedScore,
            ...(confStatus === 'DISPUTED'
              ? {}
              : {
                  disputeClaimedScore: null,
                  disputeL1Result: null,
                  disputeL1Note: null,
                  disputeL1ReviewerId: null,
                  disputeL1ReviewedAt: null,
                  disputeL2Result: null,
                  disputeL2Note: null,
                  disputeL2ReviewerId: null,
                  disputeL2ReviewedAt: null,
                }),
            rejectReason: null,
          },
          create: {
            submissionId: sub.id,
            itemId: sys.itemId,
            selected: sys.selected as Prisma.InputJsonValue,
            score: sys.score,
            status: itemStatus,
            isSystemFilled: true,
            confirmationStatus: confStatus ?? null,
            disputeReason,
            disputeClaimedScore,
          },
        });
        totalScore += sys.score;
      }
    }
  }

  for (const it of items) {
    if (systemFilledIds.has(it.itemId)) continue;
    if (lockedItemIds.has(it.itemId)) {
      skippedItems.push(it.itemId);
      const existingItem = existingMap.get(it.itemId);
      if (existingItem) totalScore += Number(existingItem.score);
      continue;
    }

    const meta = itemMeta.get(it.itemId);
    if (!meta) continue;
    const existingItem = existingMap.get(it.itemId);
    const existingSelected = Array.isArray(existingItem?.selected)
      ? existingItem.selected as Array<{
          index: number;
          optionId?: string;
          label?: string;
          score?: number;
          count?: number;
        }>
      : [];
    const lockedOptionIds = new Set(
      (existingItem?.optionReviews ?? [])
        .filter((review) => review.status === 'L2_APPROVED')
        .map((review) => review.optionId),
    );
    const isEmployeeDeclaredFact = isFactDataSourceDimension(meta.dimensionCode);
    const isDeduction = meta.dimensionCode?.startsWith('special.') ?? false;
    if (it.declaredScore != null && !isEmployeeDeclaredFact) {
      throw new DeclarationError(`「${meta.title}」不允许直接填写分数`);
    }
    if (
      it.declaredScore != null &&
      (isDeduction
        ? it.declaredScore > 0
        : it.declaredScore < 0 || (meta.maxScore != null && it.declaredScore > meta.maxScore))
    ) {
      throw new DeclarationError(`「${meta.title}」申报分数不符合该评分项的分值范围`);
    }
    const normalizedInput = it.declaredScore != null
      ? [{
          index: 0,
          optionId: 'employee-declared-score',
          label: '员工申报分数',
          score: it.declaredScore,
        }]
      : normalizeSelectedOptions(it.itemId, meta.scoreOptions, it.selected);
    const existingSelectedByOption = new Map<
      string,
      { index: number; optionId: string; label: string; score: number; count?: number }
    >();
    for (const selected of existingSelected) {
      const normalizedExisting = normalizeSelectedOptions(it.itemId, meta.scoreOptions, [selected]);
      for (const row of normalizedExisting) existingSelectedByOption.set(row.optionId, row);
    }
    const selectedByOption = new Map<
      string,
      { index: number; optionId: string; label: string; score: number; count?: number }
    >();
    for (const row of normalizedInput) {
      selectedByOption.set(
        row.optionId,
        lockedOptionIds.has(row.optionId)
          ? existingSelectedByOption.get(row.optionId) ?? row
          : row,
      );
    }
    for (const optionId of lockedOptionIds) {
      const locked = existingSelectedByOption.get(optionId);
      if (locked) selectedByOption.set(optionId, locked);
    }
    const normalizedSelected = Array.from(selectedByOption.values()).sort(
      (a, b) => a.index - b.index,
    );
    const score = computeItemScore(meta, normalizedSelected);

    if (submit) {
      if (meta.isRequired && normalizedSelected.length === 0) {
        throw new DeclarationError(`「${meta.title}」为必填项，请选择分值`);
      }
      if (isEmployeeDeclaredFact) {
        if (!it.content?.trim()) {
          throw new DeclarationError(`请填写「${meta.title}」的事实说明`);
        }
        if (it.declaredScore == null) {
          throw new DeclarationError(`请填写「${meta.title}」的申报分数`);
        }
        const attCount = attachmentCounts?.get(it.itemId) ?? 0;
        if (attCount === 0) {
          throw new DeclarationError(`「${meta.title}」须上传截图证明材料`);
        }
      }
      if (meta.requireAttachment && normalizedSelected.length > 0) {
        const attCount = attachmentCounts?.get(it.itemId) ?? 0;
        if (attCount === 0) {
          throw new DeclarationError(`「${meta.title}」要求上传证明材料`);
        }
      }
    }

    const newStatus = submit
      ? (submitMode === 'AFFIRM' ? 'L2_APPROVED' : 'PENDING_L1')
      : 'DRAFT';
    const confStatus = it.confirmationStatus;
    const isSystem = !!it.isSystemFilled;
    await tx.submissionItem.upsert({
      where: { submissionId_itemId: { submissionId: sub.id, itemId: it.itemId } },
      update: {
        selected: normalizedSelected as unknown as Prisma.InputJsonValue,
        content: it.content,
        score,
        status: newStatus,
        rejectReason: null,
        ...(confStatus ? { confirmationStatus: confStatus } : {}),
        disputeReason: it.disputeReason ?? null,
        isSystemFilled: isSystem,
      },
      create: {
        submissionId: sub.id,
        itemId: it.itemId,
        selected: normalizedSelected as unknown as Prisma.InputJsonValue,
        content: it.content,
        score,
        status: newStatus,
        ...(confStatus ? { confirmationStatus: confStatus } : {}),
        disputeReason: it.disputeReason ?? null,
        isSystemFilled: isSystem,
      },
    });
    totalScore += score;
  }

  if (submit) {
    if (sub.status === 'REJECTED') {
      await tx.reviewLog.create({
        data: {
          submissionId: sub.id,
          reviewerId: userId,
          level: 0,
          action: 'APPROVE',
          note: '员工重新提交',
        },
      });
    }
    if (!preReview.passed) {
      await tx.reviewLog.create({
        data: {
          submissionId: sub.id,
          reviewerId: userId,
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
        preReviewMessages: preReview.messages as unknown as Prisma.InputJsonValue,
        preReviewMatchedRules: preReview.matchedRuleIds as unknown as Prisma.InputJsonValue,
        submittedAt: originalSubmittedAt ?? new Date(),
        totalScore,
        ...(submitMode === 'AFFIRM'
          ? {}
          : { status: 'SUBMITTED' as const }),
      },
    });

    if (submitMode === 'AFFIRM') {
      totalScore = await finalizeAffirmSubmission(tx, sub.id, userId);
      finalized = true;
    }
  } else {
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

  return {
    submissionId,
    totalScore,
    employeeContact: user.contact,
    preReviewMessages,
    skippedItems,
    unrepairedItems: unrepairedRejected,
    ...(finalized ? { finalized: true } : {}),
  };
}
