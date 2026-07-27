export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

const ReviewSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['REVIEWED', 'RETURNED_FOR_CORRECTION']),
  note: z.string().trim().min(2).max(1000),
});

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const logs = await prisma.factImportLog.findMany({
    where: { year, kind: 'detail-reconciliation' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const employeeNos = [
    ...new Set(logs.flatMap((log) => {
      const unmatched = objectValue(log.unmatched);
      const mismatches = Array.isArray(unmatched.scoreMismatches)
        ? unmatched.scoreMismatches
        : [];
      return mismatches.flatMap((row) => {
        const employeeNo = objectValue(row).employeeNo;
        return typeof employeeNo === 'string' ? [employeeNo] : [];
      });
    })),
  ];
  const users = employeeNos.length
    ? await prisma.user.findMany({
        where: { employeeNo: { in: employeeNos } },
        select: { employeeNo: true, fullName: true },
      })
    : [];
  const nameByNo = new Map(users.map((user) => [user.employeeNo!, user.fullName]));

  return NextResponse.json({
    success: true,
    year,
    rows: logs.map((log) => {
      const summary = objectValue(log.summary);
      const unmatched = objectValue(log.unmatched);
      const mismatches = Array.isArray(unmatched.scoreMismatches)
        ? unmatched.scoreMismatches.map((row) => {
            const mismatch = objectValue(row);
            const employeeNo = String(mismatch.employeeNo ?? '');
            return {
              employeeNo,
              employeeName: nameByNo.get(employeeNo) ?? '',
              previous: Number(mismatch.previous ?? 0),
              next: Number(mismatch.next ?? 0),
              difference: Math.round(
                (Number(mismatch.next ?? 0) - Number(mismatch.previous ?? 0)) * 100,
              ) / 100,
            };
          })
        : [];
      return {
        id: log.id,
        createdAt: log.createdAt,
        sourceFiles: log.sourceFiles,
        summary,
        coverageIssue: typeof unmatched.coverageIssue === 'string'
          ? unmatched.coverageIssue
          : null,
        mismatches,
      };
    }),
  });
}

export async function PATCH(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const parsed = ReviewSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
  }

  const log = await prisma.factImportLog.findUnique({ where: { id: parsed.data.id } });
  if (!log || log.kind !== 'detail-reconciliation') {
    return NextResponse.json({ error: '复核记录不存在' }, { status: 404 });
  }
  const summary = objectValue(log.summary);
  if (summary.status !== 'PENDING_MANUAL_REVIEW') {
    return NextResponse.json({ error: '该记录已处理' }, { status: 409 });
  }
  await prisma.factImportLog.update({
    where: { id: log.id },
    data: {
      summary: {
        ...summary,
        status: parsed.data.action,
        reviewNote: parsed.data.note,
        reviewedBy: session.userId,
        reviewedAt: new Date().toISOString(),
        scoreDataApplied: false,
      },
    },
  });
  return NextResponse.json({ success: true });
}
