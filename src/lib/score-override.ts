/**
 * 申诉得分覆盖：L2 确认有效后，管理员按维度整项调整分数（不改事实台账）。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { computeSectionScores, type ScorableSection } from '@/lib/score-calculation';
import { SCORING_STANDARD_BY_CODE } from '@/lib/scoring-standards';
import { persistSubmissionDimensionFacts } from '@/lib/submission-fact-persistence';
import { captureFinalFactSnapshot } from '@/lib/final-fact-snapshot';

export const SCORE_OVERRIDE_DIMENSION_CODES = [
  'basic.skill-level',
  'basic.title-level',
  'basic.performance-level',
  'worksite.ticket-execution',
  'worksite.defect-governance',
  'performance.safety-contribution',
  'performance.technical-contribution',
  'performance.competition',
  'performance.innovation',
  'special.violation-severe',
  'special.violation-general',
] as string[];

export type ScoreOverrideListStatus = 'pending' | 'corrected' | 'all';

/** Prisma filter for L2-approved system-fact appeals awaiting / having score overrides. */
export function eligibleScoreOverrideItemWhere(
  status: ScoreOverrideListStatus = 'pending',
): Prisma.SubmissionItemWhereInput {
  return {
    isSystemFilled: true,
    confirmationStatus: 'DISPUTED',
    disputeL2Result: 'APPROVED',
    item: { dimensionCode: { in: SCORE_OVERRIDE_DIMENSION_CODES } },
    ...(status === 'pending' ? { overrideScore: null } : {}),
    ...(status === 'corrected' ? { overrideScore: { not: null } } : {}),
  };
}

export function resolveDimensionMaxScore(
  dimensionCode: string | null | undefined,
  formItemMaxScore?: number | null,
): number {
  const standard = dimensionCode ? SCORING_STANDARD_BY_CODE[dimensionCode] : undefined;
  if (standard && standard.maxScore > 0) return standard.maxScore;
  if (formItemMaxScore != null && Number(formItemMaxScore) > 0) return Number(formItemMaxScore);
  return standard?.maxScore ?? 0;
}

export function isDeductionDimension(dimensionCode: string | null | undefined): boolean {
  if (!dimensionCode) return false;
  return SCORING_STANDARD_BY_CODE[dimensionCode]?.dataSource === 'deduction';
}

/**
 * 有效得分：管理员覆盖分优先，否则为系统原分（score 永不因覆盖而改写）。
 * 审核「系统分值」读 score；总分/归档聚合读本函数。
 */
export function effectiveSubmissionItemScore(item: {
  score: number | string | null | undefined;
  overrideScore?: number | string | null;
}): number {
  if (item.overrideScore != null && item.overrideScore !== '') {
    const overridden = Number(item.overrideScore);
    if (Number.isFinite(overridden)) return overridden;
  }
  return Number(item.score ?? 0);
}

/** Validate admin override score against dimension rules. Returns error message or null. */
export function validateOverrideScore(input: {
  overrideScore: number;
  dimensionCode: string | null | undefined;
  formItemMaxScore?: number | null;
}): string | null {
  const { overrideScore, dimensionCode, formItemMaxScore } = input;
  if (!Number.isFinite(overrideScore)) return '分数无效';
  if (isDeductionDimension(dimensionCode)) {
    if (overrideScore > 0) return '扣分项覆盖分须为 0 或负数';
    return null;
  }
  if (overrideScore < 0) return '分数不可为负数';
  const maxScore = resolveDimensionMaxScore(dimensionCode, formItemMaxScore);
  if (maxScore > 0 && overrideScore > maxScore) {
    return `覆盖分不可超过该计分项满分 ${maxScore}`;
  }
  return null;
}

export interface ApplyScoreOverrideInput {
  submissionItemId: string;
  overrideScore: number;
  overrideReason: string;
  adminUserId: string;
}

export interface ApplyScoreOverrideResult {
  oldScore: number;
  newScore: number;
  totalScore: number;
  submissionId: string;
}

type Db = PrismaClient | Prisma.TransactionClient;

async function loadTemplateSections(tx: Db, templateId: string): Promise<ScorableSection[]> {
  const template = await tx.formTemplate.findUnique({
    where: { id: templateId },
    select: {
      sections: {
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
      },
    },
  });
  return (template?.sections ?? []).map((section) => ({
    id: section.id,
    title: section.title,
    sortOrder: section.sortOrder,
    items: section.items.map((item) => ({
      id: item.id,
      scoreMode: item.scoreMode,
      maxScore: item.maxScore != null ? Number(item.maxScore) : null,
      maxSelections: item.maxSelections,
      scoreOptions: item.scoreOptions,
      sortOrder: item.sortOrder,
    })),
  }));
}

/** Apply dimension-level score override and sync submission + archive totals. */
export async function applyScoreOverride(
  prisma: PrismaClient,
  input: ApplyScoreOverrideInput,
): Promise<ApplyScoreOverrideResult> {
  const item = await prisma.submissionItem.findUnique({
    where: { id: input.submissionItemId },
    include: {
      item: true,
      submission: { include: { template: true } },
    },
  });
  if (!item) throw Object.assign(new Error('申报项不存在'), { httpStatus: 404 });
  if (!item.isSystemFilled) throw Object.assign(new Error('仅可覆盖系统填充项'), { httpStatus: 400 });
  if (item.confirmationStatus !== 'DISPUTED') {
    throw Object.assign(new Error('仅申诉项可覆盖分数'), { httpStatus: 400 });
  }
  if (item.disputeL2Result !== 'APPROVED') {
    throw Object.assign(new Error('申诉需经二级审核确认有效后方可覆盖'), { httpStatus: 400 });
  }

  const validationError = validateOverrideScore({
    overrideScore: input.overrideScore,
    dimensionCode: item.item.dimensionCode,
    formItemMaxScore: item.item.maxScore != null ? Number(item.item.maxScore) : null,
  });
  if (validationError) throw Object.assign(new Error(validationError), { httpStatus: 400 });

  // 变更前有效分（已覆盖则用覆盖分，否则系统原分）；系统原分 score 字段保持不变
  const oldScore = effectiveSubmissionItemScore(item);
  const systemScore = Number(item.score);
  const newScore = input.overrideScore;

  return prisma.$transaction(async (tx) => {
    await tx.submissionItem.update({
      where: { id: item.id },
      data: {
        overrideScore: newScore,
        overrideReason: input.overrideReason,
        overrideBy: input.adminUserId,
        overrideAt: new Date(),
        // 故意不改 score：保留系统原始分供审核「系统分值」展示
      },
    });

    const allItems = await tx.submissionItem.findMany({
      where: { submissionId: item.submissionId },
    });
    // 当前项刚写入 override，findMany 已含新值；其余项用 override ?? score
    const totalScore = allItems.reduce(
      (sum, row) => sum + effectiveSubmissionItemScore(row),
      0,
    );
    await tx.submission.update({
      where: { id: item.submissionId },
      data: { totalScore },
    });

    await tx.reviewLog.create({
      data: {
        submissionId: item.submissionId,
        submissionItemId: item.id,
        reviewerId: input.adminUserId,
        level: 3,
        action: 'APPROVE',
        note: `管理员覆盖分：${oldScore} → ${newScore} 分（系统原分 ${systemScore}），原因：${input.overrideReason}`,
      },
    });

    const record = await tx.performanceRecord.findUnique({
      where: {
        userId_year: {
          userId: item.submission.userId,
          year: item.submission.template.year,
        },
      },
    });
    if (record) {
      const archivedData = (record.archivedData ?? {}) as {
        items?: Array<{
          itemId: string;
          score: number;
          overrideScore?: number | null;
          overrideReason?: string | null;
        }>;
        sections?: unknown;
      };
      if (Array.isArray(archivedData.items)) {
        const target = archivedData.items.find((row) => row.itemId === item.itemId);
        if (target) {
          // score = 系统原分；最终生效分在 overrideScore
          target.score = systemScore;
          target.overrideScore = newScore;
          target.overrideReason = input.overrideReason;
        }
      }
      const templateSections = await loadTemplateSections(tx, item.submission.templateId);
      archivedData.sections = computeSectionScores(
        templateSections,
        new Map(allItems.map((row) => [row.itemId, effectiveSubmissionItemScore(row)])),
      );
      // 刷新申诉补充事实与终审事实快照，供查询/报表导出
      await persistSubmissionDimensionFacts(tx, item.submissionId, new Date());
      const factSnapshot = await captureFinalFactSnapshot(tx, {
        submissionId: item.submissionId,
        archivedTotalScore: totalScore,
        capturedAt: new Date(),
        captureMode: 'REBUILT_CURRENT_FACTS',
      });
      if (factSnapshot) {
        (archivedData as { factSnapshot?: unknown }).factSnapshot = factSnapshot;
      }
      await tx.performanceRecord.update({
        where: { id: record.id },
        data: {
          totalScore,
          archivedData: archivedData as Prisma.InputJsonValue,
        },
      });
    } else {
      // 尚未归档时也落库申诉补充事实，便于后续查询
      await persistSubmissionDimensionFacts(tx, item.submissionId, new Date());
    }

    return {
      oldScore,
      newScore,
      totalScore,
      submissionId: item.submissionId,
    };
  });
}
