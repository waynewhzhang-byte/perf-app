export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { eligibleFactCorrectionItemWhere } from '@/lib/fact-correction';
import { loadPerformanceScoreSheet } from '@/lib/performance-score-sheet';
import { SCORING_STANDARD_BY_CODE } from '@/lib/scoring-standards';
import { resolveDimensionMaxScore } from '@/lib/score-override';

async function listEligibleOverrides(url: URL) {
  const statusParam = url.searchParams.get('status') ?? 'pending';
  const status = statusParam === 'corrected' || statusParam === 'all' ? statusParam : 'pending';
  const yearRaw = url.searchParams.get('year');
  const year = yearRaw ? Number(yearRaw) : null;
  const keyword = url.searchParams.get('keyword')?.trim() ?? '';

  const andFilters: Prisma.SubmissionItemWhereInput[] = [eligibleFactCorrectionItemWhere(status)];
  if (year != null && Number.isFinite(year)) {
    andFilters.push({ submission: { template: { year } } });
  }
  if (keyword) {
    andFilters.push({
      OR: [
        { submission: { user: { employeeNo: { contains: keyword, mode: 'insensitive' } } } },
        { submission: { user: { fullName: { contains: keyword, mode: 'insensitive' } } } },
        { item: { title: { contains: keyword, mode: 'insensitive' } } },
      ],
    });
  }

  const items = await prisma.submissionItem.findMany({
    where: { AND: andFilters },
    include: {
      item: { select: { id: true, title: true, dimensionCode: true } },
      submission: {
        select: {
          id: true,
          status: true,
          totalScore: true,
          user: {
            select: {
              employeeNo: true,
              fullName: true,
              branch: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
          template: { select: { year: true, title: true } },
        },
      },
    },
    orderBy: [{ disputeL2ReviewedAt: 'desc' }, { updatedAt: 'desc' }],
  });

  const bySubmission = new Map<string, {
    submissionId: string;
    status: string;
    totalScore: number;
    employeeNo: string | null;
    employeeName: string;
    branchName: string | null;
    departmentName: string | null;
    year: number;
    templateTitle: string;
    pendingItemCount: number;
    correctedItemCount: number;
    itemTitles: string[];
    latestL2ReviewedAt: string | null;
  }>();

  for (const row of items) {
    const submissionId = row.submission.id;
    const existing = bySubmission.get(submissionId);
    const corrected = row.overrideScore != null;
    const l2At = row.disputeL2ReviewedAt?.toISOString() ?? null;
    if (!existing) {
      bySubmission.set(submissionId, {
        submissionId,
        status: row.submission.status,
        totalScore: Number(row.submission.totalScore),
        employeeNo: row.submission.user.employeeNo,
        employeeName: row.submission.user.fullName,
        branchName: row.submission.user.branch?.name ?? null,
        departmentName: row.submission.user.department?.name ?? null,
        year: row.submission.template.year,
        templateTitle: row.submission.template.title,
        pendingItemCount: corrected ? 0 : 1,
        correctedItemCount: corrected ? 1 : 0,
        itemTitles: [row.item.title],
        latestL2ReviewedAt: l2At,
      });
      continue;
    }
    if (!corrected) existing.pendingItemCount += 1;
    else existing.correctedItemCount += 1;
    if (!existing.itemTitles.includes(row.item.title)) existing.itemTitles.push(row.item.title);
    if (l2At && (!existing.latestL2ReviewedAt || l2At > existing.latestL2ReviewedAt)) {
      existing.latestL2ReviewedAt = l2At;
    }
  }

  const [pendingCount, correctedCount] = await Promise.all([
    prisma.submissionItem.count({ where: eligibleFactCorrectionItemWhere('pending') }),
    prisma.submissionItem.count({ where: eligibleFactCorrectionItemWhere('corrected') }),
  ]);

  return NextResponse.json({
    success: true,
    status,
    pendingCount,
    correctedCount,
    rows: [...bySubmission.values()],
  });
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const url = new URL(req.url);
    const submissionId = url.searchParams.get('submissionId');
    if (!submissionId) return listEligibleOverrides(url);

    const items = await prisma.submissionItem.findMany({
      where: {
        submissionId,
        isSystemFilled: true,
        confirmationStatus: 'DISPUTED',
        disputeL2Result: 'APPROVED',
      },
      include: {
        item: true,
        attachments: { select: { id: true, filename: true, mimeType: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        user: { select: { id: true, employeeNo: true, fullName: true } },
        template: { select: { id: true, year: true } },
      },
    });
    if (!submission?.user.employeeNo) {
      return NextResponse.json({ error: '申报或员工不存在' }, { status: 404 });
    }

    const sheet = await loadPerformanceScoreSheet({
      prisma,
      year: submission.template.year,
      employeeNo: submission.user.employeeNo,
      templateId: submission.template.id,
      userId: submission.user.id,
    });

    const sheetRowByItemId = new Map(
      (sheet?.sections ?? []).flatMap((section) =>
        section.items
          .filter((row) => row.itemId)
          .map((row) => [row.itemId!, row] as const),
      ),
    );

    const details = items.map((row) => {
      const dimensionCode = row.item.dimensionCode ?? '';
      const standard = SCORING_STANDARD_BY_CODE[dimensionCode];
      const sheetRow = sheetRowByItemId.get(row.itemId);
      const selectedLines = Array.isArray(row.selected)
        ? (row.selected as Array<{ label?: string; score?: number; detail?: string }>).map((line, index) => ({
          label: line.label ?? `计分明细 ${index + 1}`,
          score: Number(line.score ?? 0),
          detail: line.detail,
        }))
        : [];
      const scoreLines = (sheetRow?.lines ?? []).map((line) => ({
        label: line.label,
        score: line.score,
        detail: line.detail,
      }));
      const displayLines = scoreLines.length > 0 ? scoreLines : selectedLines;
      const maxScore = resolveDimensionMaxScore(
        dimensionCode,
        row.item.maxScore != null ? Number(row.item.maxScore) : null,
      );
      const linesSum = displayLines.reduce((sum, line) => sum + Number(line.score), 0);
      const systemScore = displayLines.length > 0
        ? (maxScore > 0 ? Math.min(linesSum, maxScore) : linesSum)
        : Number(row.score);
      const currentScore = row.overrideScore != null
        ? Number(row.overrideScore)
        : Number(row.score);

      return {
        submissionItemId: row.id,
        formItemId: row.itemId,
        title: row.item.title,
        dimensionCode,
        maxScore,
        currentScore,
        systemScore,
        disputeClaimedScore: row.disputeClaimedScore == null ? null : Number(row.disputeClaimedScore),
        disputeReason: row.disputeReason,
        disputeL1Note: row.disputeL1Note,
        disputeL2Note: row.disputeL2Note,
        ruleSummary: standard?.scoringSummary ?? sheetRow?.ruleSummary ?? '',
        scoreLines: displayLines,
        attachments: row.attachments,
        overrideScore: row.overrideScore == null ? null : Number(row.overrideScore),
        overrideReason: row.overrideReason,
        overrideAt: row.overrideAt?.toISOString() ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      employee: submission.user,
      year: submission.template.year,
      totalScore: Number(submission.totalScore),
      items: details,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { error: '已改为管理员直接调整得分，请使用 POST /api/admin/override' },
    { status: 410 },
  );
}
