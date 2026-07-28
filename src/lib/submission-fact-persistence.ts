/**
 * 二级审核归档后，将员工自助申报的手工维度子项、以及二审确认有效的申诉，
 * 落库为可查询/可导出的补充事实。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeSelectedOptions, type ScoreOptionLike } from '@/lib/form-options';
import { inferDimensionCodeFromTitle, SCORING_STANDARD_BY_CODE } from '@/lib/scoring-standards';

export const SUBMISSION_FACT_SOURCE_PREFIX = 'submission:';
export const APPEAL_SUPPLEMENT_SOURCE_PREFIX = 'appeal-supplement:';
export const APPEAL_SUPPLEMENT_OPTION_ID = 'appeal-supplement';
export const APPEAL_SUPPLEMENT_SOURCE = 'appeal-supplement';

export function submissionFactSourceFile(submissionId: string): string {
  return `${SUBMISSION_FACT_SOURCE_PREFIX}${submissionId}`;
}

export function appealSupplementSourceFile(submissionId: string): string {
  return `${APPEAL_SUPPLEMENT_SOURCE_PREFIX}${submissionId}`;
}

export function isAppealSupplementSourceFile(sourceFile: string | null | undefined): boolean {
  return Boolean(sourceFile?.startsWith(APPEAL_SUPPLEMENT_SOURCE_PREFIX));
}

export function isAppealSupplementMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (metadata as { source?: unknown }).source === APPEAL_SUPPLEMENT_SOURCE;
}

export interface SubmissionFactLine {
  submissionItemId: string;
  formItemId: string;
  dimensionCode: string;
  dimensionTitle: string;
  optionId: string;
  label: string;
  unitScore: number;
  count: number;
  score: number;
  content?: string | null;
  departmentId?: string | null;
  sourceFile?: string;
  metadata?: Record<string, unknown>;
}

type SubmissionItemWithRelations = {
  id: string;
  itemId: string;
  status: string;
  isSystemFilled: boolean;
  content: string | null;
  selected: unknown;
  score?: Prisma.Decimal | number | null;
  confirmationStatus?: string | null;
  disputeReason?: string | null;
  disputeClaimedScore?: Prisma.Decimal | number | null;
  disputeL1Result?: string | null;
  disputeL1Note?: string | null;
  disputeL2Result?: string | null;
  disputeL2Note?: string | null;
  overrideScore?: Prisma.Decimal | number | null;
  overrideReason?: string | null;
  item: {
    title: string;
    dimensionCode: string | null;
    scoreOptions: unknown;
  };
  optionReviews: Array<{
    optionId: string;
    label: string;
    score: Prisma.Decimal | number;
    count: number | null;
    departmentId: string;
    status: string;
  }>;
  attachments: Array<{
    id: string;
    filename: string;
    storageKey: string;
    mimeType: string | null;
  }>;
};

function resolveDimensionCode(item: SubmissionItemWithRelations['item']): string | null {
  if (item.dimensionCode) return item.dimensionCode;
  return inferDimensionCodeFromTitle(item.title);
}

function isEmployeeDeclaredDimension(code: string): boolean {
  return Boolean(SCORING_STANDARD_BY_CODE[code]);
}

function attachmentMeta(row: SubmissionItemWithRelations) {
  return row.attachments.map((att) => ({
    id: att.id,
    filename: att.filename,
    storageKey: att.storageKey,
    mimeType: att.mimeType,
  }));
}

/**
 * 二审确认有效的系统事实申诉 → 补充事实（供查询/导出；不计分重复加总）。
 */
export function extractApprovedAppealSupplementFacts(
  items: SubmissionItemWithRelations[],
  approvedAt: Date,
  submissionId?: string,
): SubmissionFactLine[] {
  const lines: SubmissionFactLine[] = [];

  for (const row of items) {
    if (!row.isSystemFilled) continue;
    if (row.confirmationStatus !== 'DISPUTED') continue;
    if (row.disputeL2Result !== 'APPROVED') continue;
    if (row.status !== 'L2_APPROVED') continue;

    const dimensionCode = resolveDimensionCode(row.item);
    if (!dimensionCode || !isEmployeeDeclaredDimension(dimensionCode)) continue;

    const standard = SCORING_STANDARD_BY_CODE[dimensionCode];
    const overrideScore = row.overrideScore == null ? null : Number(row.overrideScore);
    const currentScore = row.score == null ? 0 : Number(row.score);
    const finalScore = overrideScore ?? currentScore;
    const claimed = row.disputeClaimedScore == null ? null : Number(row.disputeClaimedScore);

    lines.push({
      submissionItemId: row.id,
      formItemId: row.itemId,
      dimensionCode,
      dimensionTitle: standard?.title ?? row.item.title,
      optionId: APPEAL_SUPPLEMENT_OPTION_ID,
      label: '申诉确认补充事实',
      unitScore: finalScore,
      count: 1,
      score: finalScore,
      content: row.disputeReason?.trim() || row.content,
      sourceFile: submissionId ? appealSupplementSourceFile(submissionId) : undefined,
      metadata: {
        source: APPEAL_SUPPLEMENT_SOURCE,
        approvedAt: approvedAt.toISOString(),
        disputeClaimedScore: claimed,
        finalScore,
        overrideScore,
        overrideReason: row.overrideReason ?? null,
        disputeL1Result: row.disputeL1Result ?? null,
        disputeL1Note: row.disputeL1Note ?? null,
        disputeL2Result: row.disputeL2Result,
        disputeL2Note: row.disputeL2Note ?? null,
        attachments: attachmentMeta(row),
      },
    });
  }

  return lines;
}

/** 从已终审申报项提取可落库的事实行（纯函数，便于测试） */
export function extractSubmissionDimensionFacts(
  items: SubmissionItemWithRelations[],
  approvedAt: Date,
  submissionId?: string,
): SubmissionFactLine[] {
  const lines: SubmissionFactLine[] = [];

  for (const row of items) {
    if (row.isSystemFilled) continue;
    if (row.status !== 'L2_APPROVED') continue;

    const dimensionCode = resolveDimensionCode(row.item);
    // 系统导入事实项会以 isSystemFilled 标记跳过；其余二审通过项都是员工
    // 补充/自填事实，必须作为可追溯的年度事实落库。
    if (!dimensionCode || !isEmployeeDeclaredDimension(dimensionCode)) continue;

    const standard = SCORING_STANDARD_BY_CODE[dimensionCode];
    const scoreOptions = (Array.isArray(row.item.scoreOptions)
      ? row.item.scoreOptions
      : []) as ScoreOptionLike[];

    const baseMetadata = {
      source: 'submission',
      approvedAt: approvedAt.toISOString(),
      attachments: attachmentMeta(row),
    };
    const defaultSourceFile = submissionId ? submissionFactSourceFile(submissionId) : undefined;

    const approvedReviews = row.optionReviews.filter((review) => review.status === 'L2_APPROVED');
    if (approvedReviews.length > 0) {
      for (const review of approvedReviews) {
        const count = review.count ?? 1;
        const unitScore = Number(review.score);
        lines.push({
          submissionItemId: row.id,
          formItemId: row.itemId,
          dimensionCode,
          dimensionTitle: standard?.title ?? row.item.title,
          optionId: review.optionId,
          label: review.label,
          unitScore,
          count,
          score: unitScore * count,
          content: row.content,
          departmentId: review.departmentId,
          sourceFile: defaultSourceFile,
          metadata: baseMetadata,
        });
      }
      continue;
    }

    const selected = normalizeSelectedOptions(
      row.itemId,
      scoreOptions,
      Array.isArray(row.selected) ? (row.selected as Parameters<typeof normalizeSelectedOptions>[2]) : [],
    );
    for (const option of selected) {
      const count = option.count ?? 1;
      lines.push({
        submissionItemId: row.id,
        formItemId: row.itemId,
        dimensionCode,
        dimensionTitle: standard?.title ?? row.item.title,
        optionId: option.optionId,
        label: option.label,
        unitScore: option.score,
        count,
        score: option.score * count,
        content: row.content,
        sourceFile: defaultSourceFile,
        metadata: baseMetadata,
      });
    }
  }

  return [
    ...lines,
    ...extractApprovedAppealSupplementFacts(items, approvedAt, submissionId),
  ];
}

export interface PersistSubmissionFactsResult {
  deleted: number;
  created: number;
}

type TxClient = Pick<PrismaClient, 'submissionDimensionFact' | 'submission' | 'user'>;

/** 归档时写入/刷新该申报对应的维度事实（含申诉补充） */
export async function persistSubmissionDimensionFacts(
  tx: TxClient,
  submissionId: string,
  approvedAt: Date = new Date(),
): Promise<PersistSubmissionFactsResult> {
  const sub = await tx.submission.findUnique({
    where: { id: submissionId },
    include: {
      template: { select: { year: true } },
      user: { select: { id: true, employeeNo: true, fullName: true } },
      items: {
        include: {
          item: true,
          optionReviews: true,
          attachments: true,
        },
      },
    },
  });

  if (!sub?.user.employeeNo) {
    return { deleted: 0, created: 0 };
  }

  const lines = extractSubmissionDimensionFacts(sub.items, approvedAt, submissionId);

  const deleted = (
    await tx.submissionDimensionFact.deleteMany({
      where: { submissionId },
    })
  ).count;

  let created = 0;
  for (const line of lines) {
    await tx.submissionDimensionFact.create({
      data: {
        year: sub.template.year,
        employeeNo: sub.user.employeeNo,
        employeeName: sub.user.fullName,
        userId: sub.user.id,
        submissionId,
        submissionItemId: line.submissionItemId,
        formItemId: line.formItemId,
        dimensionCode: line.dimensionCode,
        dimensionTitle: line.dimensionTitle,
        optionId: line.optionId,
        label: line.label,
        unitScore: line.unitScore,
        count: line.count,
        score: line.score,
        content: line.content ?? null,
        departmentId: line.departmentId ?? null,
        sourceFile: line.sourceFile ?? submissionFactSourceFile(submissionId),
        metadata: (line.metadata ?? {}) as Prisma.InputJsonValue,
        approvedAt,
      },
    });
    created++;
  }

  return { deleted, created };
}
