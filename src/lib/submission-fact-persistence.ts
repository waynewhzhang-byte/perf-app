/**
 * 二级审核归档后，将员工自助申报的手工维度子项落库为事实数据。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeSelectedOptions, type ScoreOptionLike } from '@/lib/form-options';
import { inferDimensionCodeFromTitle, SCORING_STANDARD_BY_CODE } from '@/lib/scoring-standards';

export const SUBMISSION_FACT_SOURCE_PREFIX = 'submission:';

export function submissionFactSourceFile(submissionId: string): string {
  return `${SUBMISSION_FACT_SOURCE_PREFIX}${submissionId}`;
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
  metadata?: Record<string, unknown>;
}

type SubmissionItemWithRelations = {
  id: string;
  itemId: string;
  status: string;
  isSystemFilled: boolean;
  content: string | null;
  selected: unknown;
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

function isManualOrDeductionDimension(code: string): boolean {
  const std = SCORING_STANDARD_BY_CODE[code];
  return std?.dataSource === 'manual' || std?.dataSource === 'deduction';
}

/** 从已终审申报项提取可落库的事实行（纯函数，便于测试） */
export function extractSubmissionDimensionFacts(
  items: SubmissionItemWithRelations[],
  approvedAt: Date,
): SubmissionFactLine[] {
  const lines: SubmissionFactLine[] = [];

  for (const row of items) {
    if (row.isSystemFilled) continue;
    if (row.status !== 'L2_APPROVED') continue;

    const dimensionCode = resolveDimensionCode(row.item);
    if (!dimensionCode || !isManualOrDeductionDimension(dimensionCode)) continue;

    const standard = SCORING_STANDARD_BY_CODE[dimensionCode];
    const scoreOptions = (Array.isArray(row.item.scoreOptions)
      ? row.item.scoreOptions
      : []) as ScoreOptionLike[];

    const attachmentMeta = row.attachments.map((att) => ({
      id: att.id,
      filename: att.filename,
      storageKey: att.storageKey,
      mimeType: att.mimeType,
    }));

    const baseMetadata = {
      source: 'submission',
      approvedAt: approvedAt.toISOString(),
      attachments: attachmentMeta,
    };

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
        metadata: baseMetadata,
      });
    }
  }

  return lines;
}

export interface PersistSubmissionFactsResult {
  deleted: number;
  created: number;
}

type TxClient = Pick<PrismaClient, 'submissionDimensionFact' | 'submission' | 'user'>;

/** 归档时写入/刷新该申报对应的维度事实 */
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

  const lines = extractSubmissionDimensionFacts(sub.items, approvedAt);
  const sourceFile = submissionFactSourceFile(submissionId);

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
        sourceFile,
        metadata: (line.metadata ?? {}) as Prisma.InputJsonValue,
        approvedAt,
      },
    });
    created++;
  }

  return { deleted, created };
}
