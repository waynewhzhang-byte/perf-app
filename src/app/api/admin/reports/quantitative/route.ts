// 管理员年度量化积分分析：与 data/generated 的量化积分报送表使用同一事实口径。
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import {
  buildAnnualQuantitativeReportAnalysis,
  loadAnnualQuantitativeReportRows,
} from '@/lib/annual-quantitative-report';
import { ALL_QUANTITATIVE_REPORT_UNITS } from '@/lib/quantitative-report-contract';

function resolveYear(value: string | null, years: number[]): number {
  const requested = Number(value);
  return years.includes(requested) ? requested : years[0] ?? new Date().getFullYear();
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const [performanceYears, basicYears, branches] = await Promise.all([
      prisma.performanceFact.findMany({ distinct: ['year'], select: { year: true }, orderBy: { year: 'desc' } }),
      prisma.employeeBasicFact.findMany({ distinct: ['year'], select: { year: true }, orderBy: { year: 'desc' } }),
      prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const years = [...new Set([...performanceYears, ...basicYears].map((row) => row.year))].sort((a, b) => b - a);
    const url = new URL(req.url);
    const year = resolveYear(url.searchParams.get('year'), years);
    const branchId = url.searchParams.get('branchId') || undefined;
    const branch = branchId ? branches.find((candidate) => candidate.id === branchId) : undefined;
    if (branchId && !branch) return NextResponse.json({ error: '工区不存在' }, { status: 400 });

    let skippedCount = 0;
    const rows = await loadAnnualQuantitativeReportRows(prisma, {
      year,
      unit: branch?.name ?? ALL_QUANTITATIVE_REPORT_UNITS,
      branchId: branch?.id,
      onSkip: () => { skippedCount += 1; },
    });
    return NextResponse.json({
      success: true,
      years,
      branches,
      scope: { year, branchId: branch?.id ?? null, unit: branch?.name ?? '全部部门', skippedCount },
      analysis: buildAnnualQuantitativeReportAnalysis(rows),
    });
  } catch (error) {
    console.error('GET /api/admin/reports/quantitative:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
