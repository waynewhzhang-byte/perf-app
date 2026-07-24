/**
 * 审核工作流（Review Workflow）
 *
 * L1/L2 逐选项审核 → 驳回或写入归档快照 / 绩效档案 / 申报维度事实。
 * Route 开事务并传入 tx；本 module 在事务内加载申报图并推进状态。
 * 归档拼装：`buildArchivedSnapshot`（纯）→ `finalizeArchive`（内部编排，仅 L1/L2 调用）。
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  computeSectionScores,
  computeTemplateMaxScore,
  type ScorableSection,
} from '@/lib/score-calculation';
import { persistSubmissionDimensionFacts } from '@/lib/submission-fact-persistence';
import {
  isL1ReviewQueueItem,
  resolveFormItemDimension,
} from '@/lib/system-filled-items';
import {
  isDisputeVisibleToL2Reviewer,
} from '@/lib/appeal-review-queue';
import { matchesL1Scope } from '@/lib/reviewer-scope';
import {
  dimensionReviewOptionId,
  isReviewableDimensionCode,
} from '@/lib/dimension-review-routing';

export type ReviewTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type ReviewAction = 'APPROVE' | 'REJECT';

export interface ReviewDecision {
  submissionItemId?: string;
  optionReviewId?: string;
  action: ReviewAction;
  note?: string;
  disputeAction?: ReviewAction;
  disputeNote?: string;
}

export interface ReviewCommand {
  submissionId: string;
  reviewerId: string;
  decisions: ReviewDecision[];
}

export type ReviewOutcome = 'rejected' | 'pending' | 'finalized';

export interface ReviewResult {
  outcome: ReviewOutcome;
  totalScore?: number;
  employeeContact: string;
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly httpStatus: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

/** 纯函数：待 L1 审的项是否都被决策覆盖；驳回是否带原因 */
export function validateL1Decisions(
  pendingItems: Array<{ id: string; title: string }>,
  decisions: ReviewDecision[],
): void {
  const decisionMap = new Map(
    decisions
      .filter((d) => d.submissionItemId)
      .map((d) => [d.submissionItemId!, d]),
  );
  const uncovered = pendingItems.filter((item) => !decisionMap.has(item.id));
  if (uncovered.length > 0) {
    throw new ReviewError(
      `以下申报项未做出审核决定：${uncovered.map((item) => item.title).join('、')}`,
    );
  }
  const itemReject = decisions.find((d) => d.action === 'REJECT' && !d.note?.trim());
  if (itemReject) throw new ReviewError('驳回的项必须填写原因');
}

/** 纯函数：待 L2 审的 option review 是否都被决策覆盖 */
export function validateL2Decisions(
  pendingReviews: Array<{ id: string; label: string }>,
  decisions: ReviewDecision[],
): void {
  const decisionMap = new Map(
    decisions
      .filter((d) => d.optionReviewId)
      .map((d) => [d.optionReviewId!, d]),
  );
  const uncovered = pendingReviews.filter((review) => !decisionMap.has(review.id));
  if (uncovered.length > 0) {
    throw new ReviewError(
      `以下子项未做出审核决定：${uncovered.map((review) => review.label).join('、')}`,
    );
  }
  const rejectWithoutNote = decisions.find((d) => d.action === 'REJECT' && !d.note?.trim());
  if (rejectWithoutNote) throw new ReviewError('驳回的子项必须填写原因');
}

export function isPendingL2Dispute(item: {
  isSystemFilled: boolean;
  confirmationStatus: string | null;
  disputeL1Result: string | null;
  disputeL2Result: string | null;
}): boolean {
  return item.isSystemFilled &&
    item.confirmationStatus === 'DISPUTED' &&
    item.disputeL1Result === 'APPROVED' &&
    item.disputeL2Result == null;
}

/** 全单待二审申诉数（跨部门）；L1/L2 归档前均需归零。 */
export async function countPendingL2Disputes(
  tx: ReviewTx,
  submissionId: string,
): Promise<number> {
  return tx.submissionItem.count({
    where: {
      submissionId,
      isSystemFilled: true,
      confirmationStatus: 'DISPUTED',
      disputeL1Result: 'APPROVED',
      disputeL2Result: null,
    },
  });
}

async function loadSectionsForArchive(tx: ReviewTx, templateId: string): Promise<ScorableSection[]> {
  const sections = await tx.formSection.findMany({
    where: { templateId },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      title: true,
      sortOrder: true,
      items: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          scoreMode: true,
          maxScore: true,
          maxSelections: true,
          scoreOptions: true,
          sortOrder: true,
        },
      },
    },
  });
  return sections.map((sec) => ({
    id: sec.id,
    title: sec.title,
    sortOrder: sec.sortOrder,
    items: sec.items.map((it) => ({
      id: it.id,
      scoreMode: it.scoreMode,
      maxScore: it.maxScore != null ? Number(it.maxScore) : null,
      maxSelections: it.maxSelections,
      scoreOptions: it.scoreOptions,
      sortOrder: it.sortOrder,
    })),
  }));
}

/** 归档快照输入（submission 已含 items / attachments / optionReviews） */
export interface ArchiveSubmissionSource {
  id: string;
  userId: string;
  templateId: string;
  branchId: string | null;
  workAreaName: string | null;
  hireDate: Date | null;
  workYears: number | null;
  declarationLevelId: string | null;
  declarationLevelName: string | null;
  declarationSpecialtyId: string | null;
  declarationSpecialtyName: string | null;
  preReviewPassed: boolean | null;
  preReviewMessages: unknown;
  preReviewMatchedRules: unknown;
  items: Array<{
    itemId: string;
    selected: unknown;
    content: string | null;
    score: unknown;
    item: { title: string };
    optionReviews: Array<{
      optionId: string;
      label: string;
      score: unknown;
      count: number | null;
      departmentId: string;
      department: { name: string };
      status: string;
      rejectReason: string | null;
      reviewedBy: string | null;
      reviewedAt: Date | null;
    }>;
    attachments: Array<{
      id: string;
      filename: string;
      storageKey: string;
      mimeType: string | null;
    }>;
  }>;
}

/** ADR-0002：写入 PerformanceRecord.archivedData 的 JSON 形状 */
export interface ArchivedSnapshot {
  submissionId: string;
  userId: string;
  templateId: string;
  declarationHeader: {
    workAreaId: string | null;
    workAreaName: string | null;
    hireDate: Date | null;
    workYears: number | null;
    declarationLevelId: string | null;
    declarationLevelName: string | null;
    declarationSpecialtyId: string | null;
    declarationSpecialtyName: string | null;
    preReviewPassed: boolean | null;
    preReviewMessages: unknown;
    preReviewMatchedRules: unknown;
  };
  items: Array<{
    itemId: string;
    itemTitle: string;
    selected: unknown;
    content: string | null;
    score: unknown;
    optionReviews: Array<{
      optionId: string;
      label: string;
      score: unknown;
      count: number | null;
      departmentId: string;
      departmentName: string;
      status: string;
      rejectReason: string | null;
      reviewerId: string | null;
      reviewedAt: Date | null;
    }>;
    attachments: Array<{
      id: string;
      filename: string;
      storageKey: string;
      mimeType: string | null;
    }>;
  }>;
  sections: ReturnType<typeof computeSectionScores>;
  templateMaxScore: number;
  finalizedAt: Date;
}

/**
 * 纯函数：拼装归档快照（ADR-0002）。
 * finalizedAt 由调用方注入，便于测试钉死时间，并与申报维度事实 approvedAt 对齐。
 */
export function buildArchivedSnapshot(
  sub: ArchiveSubmissionSource,
  templateSections: ScorableSection[],
  finalizedAt: Date,
): ArchivedSnapshot {
  const scoreByItemId = new Map(sub.items.map((it) => [it.itemId, Number(it.score)]));
  const sectionRows = computeSectionScores(templateSections, scoreByItemId);
  const templateMaxScore = computeTemplateMaxScore(templateSections);

  return {
    submissionId: sub.id,
    userId: sub.userId,
    templateId: sub.templateId,
    declarationHeader: {
      workAreaId: sub.branchId,
      workAreaName: sub.workAreaName,
      hireDate: sub.hireDate,
      workYears: sub.workYears,
      declarationLevelId: sub.declarationLevelId,
      declarationLevelName: sub.declarationLevelName,
      declarationSpecialtyId: sub.declarationSpecialtyId,
      declarationSpecialtyName: sub.declarationSpecialtyName,
      preReviewPassed: sub.preReviewPassed,
      preReviewMessages: sub.preReviewMessages,
      preReviewMatchedRules: sub.preReviewMatchedRules,
    },
    items: sub.items.map((it) => ({
      itemId: it.itemId,
      itemTitle: it.item.title,
      selected: it.selected,
      content: it.content,
      score: it.score,
      optionReviews: it.optionReviews.map((review) => ({
        optionId: review.optionId,
        label: review.label,
        score: review.score,
        count: review.count,
        departmentId: review.departmentId,
        departmentName: review.department.name,
        status: review.status,
        rejectReason: review.rejectReason,
        reviewerId: review.reviewedBy,
        reviewedAt: review.reviewedAt,
      })),
      attachments: it.attachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        storageKey: att.storageKey,
        mimeType: att.mimeType,
      })),
    })),
    sections: sectionRows,
    templateMaxScore,
    finalizedAt,
  };
}

/**
 * 终审通过：归档快照 + 绩效档案 + 申报维度事实。
 * @internal 仅由 applyL1 / applyL2 在全部通过时调用；导出供编排测试。
 */
export async function finalizeArchive(
  tx: ReviewTx,
  submissionId: string,
  reviewerId: string,
  approvedAt: Date = new Date(),
): Promise<number> {
  const sub = await tx.submission.findUnique({
    where: { id: submissionId },
    include: {
      template: true,
      items: {
        include: {
          item: true,
          attachments: true,
          optionReviews: { include: { department: true } },
        },
      },
    },
  });
  if (!sub) return 0;
  const total = sub.items.reduce((sum, item) => sum + Number(item.score), 0);
  const templateSections = await loadSectionsForArchive(tx, sub.templateId);
  const archived = buildArchivedSnapshot(sub, templateSections, approvedAt);
  await tx.submission.update({
    where: { id: sub.id },
    data: {
      status: 'L2_APPROVED',
      l2ReviewerId: reviewerId,
      l2ReviewedAt: approvedAt,
      totalScore: total,
    },
  });
  await tx.performanceRecord.upsert({
    where: { userId_year: { userId: sub.userId, year: sub.template.year } },
    update: {
      submissionId: sub.id,
      totalScore: total,
      archivedData: archived as unknown as Prisma.InputJsonValue,
    },
    create: {
      userId: sub.userId,
      year: sub.template.year,
      submissionId: sub.id,
      totalScore: total,
      archivedData: archived as unknown as Prisma.InputJsonValue,
    },
  });
  await persistSubmissionDimensionFacts(tx, sub.id, approvedAt);
  return total;
}

/**
 * 员工确认无异议（AFFIRM）：全部申报项标为终审通过并写入归档快照。
 * 由 declaration-workflow 在 submitMode=AFFIRM 时调用。
 */
export async function finalizeAffirmSubmission(
  tx: ReviewTx,
  submissionId: string,
  actorUserId: string,
  approvedAt: Date = new Date(),
): Promise<number> {
  await tx.submissionItem.updateMany({
    where: { submissionId },
    data: { status: 'L2_APPROVED' },
  });
  await tx.reviewLog.create({
    data: {
      submissionId,
      reviewerId: actorUserId,
      level: 0,
      action: 'APPROVE',
      note: '员工确认无异议，系统自动归档',
    },
  });
  return finalizeArchive(tx, submissionId, actorUserId, approvedAt);
}

export async function applyL1(tx: ReviewTx, cmd: ReviewCommand): Promise<ReviewResult> {
  const sub = await tx.submission.findUnique({
    where: { id: cmd.submissionId },
    include: {
      items: { include: { item: true, optionReviews: true } },
      user: true,
    },
  });
  if (!sub) throw new ReviewError('申报不存在', 404);
  if (sub.status !== 'SUBMITTED') throw new ReviewError('当前状态不可审核');

  const l1Scopes = await tx.userRole.findMany({
    where: { userId: cmd.reviewerId, role: 'REVIEWER_L1' },
  });
  if (
    !matchesL1Scope(l1Scopes, {
      branchId: sub.branchId,
      departmentId: sub.user.departmentId,
    })
  ) {
    throw new ReviewError('该申报不在您的审核范围内', 403);
  }

  const pendingItems = sub.items.filter((item) =>
    isL1ReviewQueueItem({
      status: item.status,
      isSystemFilled: !!item.isSystemFilled,
      confirmationStatus: item.confirmationStatus as 'CONFIRMED' | 'DISPUTED' | null,
    }),
  );

  validateL1Decisions(
    pendingItems.map((item) => ({ id: item.id, title: item.item.title })),
    cmd.decisions,
  );

  const decisionMap = new Map(
    cmd.decisions
      .filter((d) => d.submissionItemId)
      .map((d) => [d.submissionItemId!, d]),
  );

  let rejected = false;

  for (const item of pendingItems) {
    const decision = decisionMap.get(item.id)!;
    if (decision.action === 'REJECT') rejected = true;
    await tx.submissionItem.update({
      where: { id: item.id },
      data: {
        status: decision.action === 'REJECT' ? 'REJECTED' : 'L1_APPROVED',
        rejectReason: decision.action === 'REJECT' ? decision.note ?? null : null,
        reviewedBy: cmd.reviewerId,
        reviewedAt: new Date(),
      },
    });
    await tx.reviewLog.create({
      data: {
        submissionId: sub.id,
        submissionItemId: item.id,
        reviewerId: cmd.reviewerId,
        level: 1,
        action: decision.action,
        note: decision.note,
      },
    });

    if (item.isSystemFilled && item.confirmationStatus === 'DISPUTED') {
      if (!decision.disputeAction) {
        throw new ReviewError(
          `「${item.item.title}」存在员工申诉，请对申诉做出判断（申诉合理/申诉驳回）`,
        );
      }
      if (decision.disputeAction === 'REJECT' && !decision.disputeNote?.trim()) {
        throw new ReviewError('驳回申诉请填写原因');
      }
      const disputeResult: 'APPROVED' | 'REJECTED' =
        decision.disputeAction === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.submissionItem.update({
        where: { id: item.id },
        data: {
          disputeL1Result: disputeResult,
          disputeL1Note: decision.disputeNote ?? null,
          disputeL1ReviewerId: cmd.reviewerId,
          disputeL1ReviewedAt: new Date(),
        },
      });
      await tx.reviewLog.create({
        data: {
          submissionId: sub.id,
          submissionItemId: item.id,
          reviewerId: cmd.reviewerId,
          level: 1,
          action: decision.disputeAction,
          note: `申诉判断：${decision.disputeAction === 'APPROVE' ? '认定合理' : '驳回'}${decision.disputeNote ? `。${decision.disputeNote}` : ''}`,
        },
      });
    }
  }

  if (rejected) {
    await tx.submission.update({
      where: { id: sub.id },
      data: {
        status: 'REJECTED',
        l1ReviewerId: cmd.reviewerId,
        l1ReviewedAt: new Date(),
      },
    });
    return { outcome: 'rejected', employeeContact: sub.user.contact };
  }

  await tx.submission.update({
    where: { id: sub.id },
    data: {
      status: 'L1_APPROVED',
      l1ReviewerId: cmd.reviewerId,
      l1ReviewedAt: new Date(),
    },
  });

  // 仅评分标准注册的最终评分点进入二审路由。
  // profile.hire-date（参加工作时间）等非评分确认项不在「二审归属配置」中，
  // 跳过 optionReview 后由下方逻辑自动标为 L2_APPROVED。
  const dimensionCodes = sub.items
    .map((item) => resolveFormItemDimension(item.item))
    .filter((dimensionCode): dimensionCode is string => {
      if (!dimensionCode) return false;
      return isReviewableDimensionCode(dimensionCode);
    });
  const routes = await tx.dimensionReviewRoute.findMany({
    where: { dimensionCode: { in: dimensionCodes } },
  });
  const routeByDimension = new Map(
    routes.map((route) => [route.dimensionCode, route.departmentId]),
  );

  for (const item of sub.items) {
    if (item.isSystemFilled && item.confirmationStatus === 'CONFIRMED') {
      continue;
    }
    const dimensionCode = resolveFormItemDimension(item.item);
    if (!dimensionCode) {
      if (item.isSystemFilled) continue;
      throw new ReviewError(`「${item.item.title}」缺少稳定评分点代码，无法进入二审`);
    }
    if (!isReviewableDimensionCode(dimensionCode)) {
      continue;
    }
    const departmentId = routeByDimension.get(dimensionCode);
    if (!departmentId) {
      throw new ReviewError(
        `「${item.item.title}」尚未配置二审归属，请联系管理员在「二审归属配置」中补全`,
      );
    }
    const optionId = dimensionReviewOptionId(dimensionCode);
    await tx.submissionOptionReview.deleteMany({
      where: {
        submissionItemId: item.id,
        status: { not: 'L2_APPROVED' },
        optionId: { not: optionId },
      },
    });
    const existing = item.optionReviews.find((review) => review.optionId === optionId);
    if (existing?.status === 'L2_APPROVED') continue;
    await tx.submissionOptionReview.upsert({
      where: { submissionItemId_optionId: { submissionItemId: item.id, optionId } },
      update: {
        label: item.item.title,
        score: item.score,
        count: null,
        departmentId,
        status: 'PENDING_L2',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
      create: {
        submissionItemId: item.id,
        optionId,
        label: item.item.title,
        score: item.score,
        count: null,
        departmentId,
      },
    });
  }

  const items = await tx.submissionItem.findMany({
    where: { submissionId: sub.id },
    include: { optionReviews: true },
  });
  for (const item of items) {
    const pendingDispute = isPendingL2Dispute(item);
    if (item.optionReviews.length === 0) {
      await tx.submissionItem.update({
        where: { id: item.id },
        data: { status: pendingDispute ? 'PENDING_L2' : 'L2_APPROVED' },
      });
      continue;
    }
    const allApproved = item.optionReviews.every((review) => review.status === 'L2_APPROVED');
    await tx.submissionItem.update({
      where: { id: item.id },
      data: { status: allApproved ? 'L2_APPROVED' : 'PENDING_L2' },
    });
  }

  const remaining = await tx.submissionOptionReview.count({
    where: { submissionItem: { submissionId: sub.id }, status: 'PENDING_L2' },
  });
  const pendingDisputeCount = await countPendingL2Disputes(tx, sub.id);
  if (remaining === 0 && pendingDisputeCount === 0) {
    const totalScore = await finalizeArchive(tx, sub.id, cmd.reviewerId);
    return {
      outcome: 'finalized',
      totalScore,
      employeeContact: sub.user.contact,
    };
  }

  return { outcome: 'pending', employeeContact: sub.user.contact };
}

export async function applyL2(tx: ReviewTx, cmd: ReviewCommand): Promise<ReviewResult> {
  const sub = await tx.submission.findUnique({
    where: { id: cmd.submissionId },
    include: { user: true },
  });
  if (!sub) throw new ReviewError('申报不存在', 404);
  if (sub.status !== 'L1_APPROVED') throw new ReviewError('当前状态不可审核');

  const reviewer = await tx.user.findUnique({
    where: { id: cmd.reviewerId },
    select: { departmentId: true },
  });
  if (!reviewer?.departmentId) {
    throw new ReviewError('当前二级审核员未绑定部门', 403);
  }
  const reviewerDepartmentId = reviewer.departmentId;

  const pendingReviews = await tx.submissionOptionReview.findMany({
    where: {
      submissionItem: { submissionId: sub.id },
      departmentId: reviewerDepartmentId,
      status: 'PENDING_L2',
    },
    include: { submissionItem: { include: { item: true } } },
  });
  const pendingDisputesAll = await tx.submissionItem.findMany({
    where: {
      submissionId: sub.id,
      isSystemFilled: true,
      confirmationStatus: 'DISPUTED',
      disputeL1Result: 'APPROVED',
      disputeL2Result: null,
    },
    include: { item: true },
  });
  const routes = await tx.dimensionReviewRoute.findMany();
  const routeByDimension = new Map(routes.map((route) => [route.dimensionCode, route.departmentId]));
  const pendingDisputes = pendingDisputesAll.filter((item) =>
    isDisputeVisibleToL2Reviewer(
      resolveFormItemDimension(item.item),
      reviewerDepartmentId,
      routeByDimension,
    ),
  );
  if (pendingReviews.length === 0 && pendingDisputes.length === 0) {
    throw new ReviewError('当前没有待处理的二审子项或申诉');
  }

  validateL2Decisions(
    pendingReviews.map((review) => ({ id: review.id, label: review.label })),
    cmd.decisions,
  );

  const decisionMap = new Map(
    cmd.decisions
      .filter((d) => d.optionReviewId)
      .map((d) => [d.optionReviewId!, d]),
  );

  let hasReject = false;

  for (const review of pendingReviews) {
    const decision = decisionMap.get(review.id)!;
    if (decision.action === 'REJECT') hasReject = true;
    await tx.submissionOptionReview.update({
      where: { id: review.id },
      data: {
        status: decision.action === 'APPROVE' ? 'L2_APPROVED' : 'REJECTED',
        rejectReason: decision.action === 'REJECT' ? decision.note ?? null : null,
        reviewedBy: cmd.reviewerId,
        reviewedAt: new Date(),
      },
    });
    await tx.reviewLog.create({
      data: {
        submissionId: sub.id,
        submissionItemId: review.submissionItemId,
        reviewerId: cmd.reviewerId,
        level: 2,
        action: decision.action,
        note: `子项「${review.label}」${decision.note ? `：${decision.note}` : ''}`,
      },
    });
    if (decision.action === 'REJECT') {
      await tx.submissionItem.update({
        where: { id: review.submissionItemId },
        data: {
          status: 'REJECTED',
          rejectReason: decision.note ?? null,
          reviewedBy: cmd.reviewerId,
          reviewedAt: new Date(),
        },
      });
    }
  }

  if (hasReject) {
    await tx.submission.update({
      where: { id: sub.id },
      data: {
        status: 'REJECTED',
        l2ReviewerId: cmd.reviewerId,
        l2ReviewedAt: new Date(),
      },
    });
    return { outcome: 'rejected', employeeContact: sub.user.contact };
  }

  const affectedItemIds = Array.from(
    new Set(pendingReviews.map((review) => review.submissionItemId)),
  );
  for (const itemId of affectedItemIds) {
    const reviews = await tx.submissionOptionReview.findMany({
      where: { submissionItemId: itemId },
    });
    if (reviews.length > 0 && reviews.every((r) => r.status === 'L2_APPROVED')) {
      await tx.submissionItem.update({
        where: { id: itemId },
        data: {
          status: 'L2_APPROVED',
          reviewedBy: cmd.reviewerId,
          reviewedAt: new Date(),
          rejectReason: null,
        },
      });
    }
  }

  const disputeDecisionMap = new Map(
    cmd.decisions
      .filter((d) => d.submissionItemId && d.disputeAction)
      .map((d) => [d.submissionItemId!, d]),
  );
  for (const item of pendingDisputes) {

    const disputeDecision = disputeDecisionMap.get(item.id);
    if (!disputeDecision || !disputeDecision.disputeAction) {
      throw new ReviewError(
        `「${item.item?.title ?? item.itemId}」存在申诉（一级已认定合理），请对申诉做出确认判断`,
      );
    }
    if (disputeDecision.disputeAction === 'REJECT' && !disputeDecision.disputeNote?.trim()) {
      throw new ReviewError('驳回申诉请填写原因');
    }

    const disputeResult: 'APPROVED' | 'REJECTED' =
      disputeDecision.disputeAction === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await tx.submissionItem.update({
      where: { id: item.id },
      data: {
        disputeL2Result: disputeResult,
        disputeL2Note: disputeDecision.disputeNote ?? null,
        disputeL2ReviewerId: cmd.reviewerId,
        disputeL2ReviewedAt: new Date(),
      },
    });
    await tx.reviewLog.create({
      data: {
        submissionId: sub.id,
        submissionItemId: item.id,
        reviewerId: cmd.reviewerId,
        level: 2,
        action: disputeDecision.disputeAction,
        note: `申诉确认：${disputeDecision.disputeAction === 'APPROVE' ? '确认有效' : '认定无效'}${disputeDecision.disputeNote ? `。${disputeDecision.disputeNote}` : ''}`,
      },
    });
  }

  const remaining = await tx.submissionOptionReview.count({
    where: { submissionItem: { submissionId: sub.id }, status: 'PENDING_L2' },
  });
  const pendingDisputeCount = await countPendingL2Disputes(tx, sub.id);
  if (remaining > 0 || pendingDisputeCount > 0) {
    await tx.submission.update({
      where: { id: sub.id },
      data: { l2ReviewerId: cmd.reviewerId, l2ReviewedAt: new Date() },
    });
    return { outcome: 'pending', employeeContact: sub.user.contact };
  }

  const totalScore = await finalizeArchive(tx, sub.id, cmd.reviewerId);
  return {
    outcome: 'finalized',
    totalScore,
    employeeContact: sub.user.contact,
  };
}
