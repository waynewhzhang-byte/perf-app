export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import {
  BASIC_DIMENSION_LABELS,
  BASIC_DIMENSION_TO_CODE,
} from '@/lib/basic-dimension-map';

const PAGE_SIZE = 30;

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const search = (url.searchParams.get('search') ?? '').trim();
    const tab = url.searchParams.get('tab') ?? 'summary';

    if (tab === 'unmatched') {
      const lastLog = await prisma.factImportLog.findFirst({
        where: { year, kind: 'pipeline' },
        orderBy: { createdAt: 'desc' },
      });
      const unmatched = (lastLog?.unmatched ?? {}) as {
        inRoster?: unknown[];
        externalCount?: number;
      };

      return NextResponse.json({
        success: true,
        year,
        lastImportAt: lastLog?.createdAt ?? null,
        inRoster: unmatched.inRoster ?? [],
        externalCount: unmatched.externalCount ?? 0,
        note: '未匹配列表仅展示「姓名在基本素质名册中」但无法唯一匹配工号的记录（多为重名）。',
      });
    }

    if (tab === 'employees') {
      const where = search
        ? {
            employeeNo: { not: null },
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { employeeNo: { contains: search } },
            ],
          }
        : { employeeNo: { not: null } };

      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          select: {
            id: true,
            employeeNo: true,
            fullName: true,
            gender: true,
            branch: { select: { name: true } },
            department: { select: { name: true } },
          },
          orderBy: { employeeNo: 'asc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const nos = users.map((u) => u.employeeNo!).filter(Boolean);

      const [basicFacts, perfFacts] = await Promise.all([
        prisma.employeeBasicFact.findMany({ where: { year, employeeNo: { in: nos } } }),
        prisma.performanceFact.findMany({
          where: {
            year,
            employeeNo: { in: nos },
            dimensionCode: { in: ['worksite.ticket-execution', 'worksite.defect-governance'] },
          },
        }),
      ]);

      const basicByNo = new Map<string, typeof basicFacts>();
      for (const f of basicFacts) {
        const list = basicByNo.get(f.employeeNo) ?? [];
        list.push(f);
        basicByNo.set(f.employeeNo, list);
      }

      const perfByNo = new Map<string, typeof perfFacts>();
      for (const f of perfFacts) {
        const list = perfByNo.get(f.employeeNo) ?? [];
        list.push(f);
        perfByNo.set(f.employeeNo, list);
      }

      const rows = users.map((u) => {
        const no = u.employeeNo!;
        const basics = basicByNo.get(no) ?? [];
        const perfs = perfByNo.get(no) ?? [];
        const basicTotal = basics.reduce((s, f) => s + Number(f.score), 0);
        const ticket = perfs.find((f) => f.dimensionCode === 'worksite.ticket-execution');
        const defectFacts = perfs.filter((f) => f.dimensionCode === 'worksite.defect-governance');
        const defectRaw = defectFacts.reduce((s, f) => s + Number(f.score), 0);

        return {
          employeeNo: no,
          fullName: u.fullName,
          gender: u.gender,
          branchName: u.branch?.name ?? null,
          departmentName: u.department?.name ?? null,
          basic: {
            total: basicTotal,
            items: basics.map((f) => ({
              dimension: f.dimension,
              code: BASIC_DIMENSION_TO_CODE[f.dimension],
              label: BASIC_DIMENSION_LABELS[f.dimension],
              tierValue: f.tierValue,
              score: Number(f.score),
              yearBreakdown: f.yearBreakdown,
            })),
          },
          ticket: ticket
            ? {
                rawScore: Number(ticket.score),
                breakdown: (ticket.metadata as { breakdown?: unknown })?.breakdown ?? null,
              }
            : null,
          defect: defectFacts.length
            ? { factCount: defectFacts.length, rawScore: defectRaw }
            : null,
        };
      });

      return NextResponse.json({
        success: true,
        year,
        page,
        pageSize: PAGE_SIZE,
        total,
        rows,
      });
    }

    // summary tab (default)
    const [basicCount, ticketCount, defectCount, lastLog, recentLogs] = await Promise.all([
      prisma.employeeBasicFact.groupBy({ by: ['employeeNo'], where: { year } }),
      prisma.performanceFact.groupBy({
        by: ['employeeNo'],
        where: { year, dimensionCode: 'worksite.ticket-execution' },
      }),
      prisma.performanceFact.groupBy({
        by: ['employeeNo'],
        where: { year, dimensionCode: 'worksite.defect-governance' },
      }),
      prisma.factImportLog.findFirst({
        where: { year, kind: 'pipeline' },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.factImportLog.findMany({
        where: { year, kind: 'pipeline' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, createdAt: true, summary: true, unmatched: true },
      }),
    ]);

    const unmatched = (lastLog?.unmatched ?? {}) as { inRoster?: unknown[]; externalCount?: number };

    return NextResponse.json({
      success: true,
      year,
      coverage: {
        basic: basicCount.length,
        tickets: ticketCount.length,
        defects: defectCount.length,
      },
      lastImport: lastLog
        ? {
            at: lastLog.createdAt,
            summary: lastLog.summary,
            unmatchedInRoster: (unmatched.inRoster ?? []).length,
            externalCount: unmatched.externalCount ?? 0,
          }
        : null,
      recentImports: recentLogs,
    });
  } catch (e) {
    console.error('GET /api/admin/import/overview:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
