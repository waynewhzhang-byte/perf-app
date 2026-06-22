export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { previewBasicFacts } from '@/lib/import-preview';
import { loadBasicFactTiers, type BasicFactFieldMapping } from '@/lib/basic-fact-import';
import { rowsToFactInputs, type FactFieldMapping } from '@/lib/manual-fact-import';
import { computeFactScores, type ScoringRule } from '@/lib/scoring-engine';
import { aggregateTicketsForImport } from '@/lib/ticket-import-api';

const BodySchema = z.object({
  itemCode: z.enum(['employees', 'basic', 'tickets', 'defects', 'safety']),
  mapping: z.record(z.string(), z.string()).optional().default({}),
  rows: z.array(z.record(z.string(), z.string())).optional().default([]),
  operationRows: z.array(z.record(z.string(), z.string())).optional(),
  workRows: z.array(z.record(z.string(), z.string())).optional(),
  unitFilter: z.string().optional(),
  year: z.number().int().optional(),
});

async function loadRule(dimensionCode: string): Promise<ScoringRule> {
  const row = await prisma.scoringRule.findUnique({ where: { dimensionCode } });
  if (!row) throw new Error(`未找到维度「${dimensionCode}」的评分规则`);
  return {
    id: row.id, dimensionCode: row.dimensionCode,
    ruleType: row.ruleType as ScoringRule['ruleType'],
    cap: Number(row.cap), enabled: row.enabled,
    ...(row.config as Record<string, unknown>),
  };
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    }

    const { itemCode, mapping, rows, operationRows, workRows, unitFilter, year } = parsed.data;

    if (itemCode === 'employees') {
      if (rows.length === 0) {
        return NextResponse.json({ error: '无数据行' }, { status: 400 });
      }
      // 员工档案无分数，返回行数与字段预览
      return NextResponse.json({
        success: true,
        kind: 'status',
        rows: rows.slice(0, 20).map((r) => ({
          employeeNo: r[mapping.employeeNo] ?? '',
          fullName: r[mapping.fullName] ?? '',
          status: '将新建/更新',
        })),
      });
    }

    if (itemCode === 'basic') {
      if (rows.length === 0) {
        return NextResponse.json({ error: '无数据行' }, { status: 400 });
      }
      const tiers = await loadBasicFactTiers(prisma);
      const preview = previewBasicFacts(mapping as unknown as BasicFactFieldMapping, rows.slice(0, 20), tiers);
      return NextResponse.json({ success: true, kind: 'score', rows: preview });
    }

    // 两票：从操作票 + 工作票明细聚合原始分（折算在最终汇总阶段）
    if (itemCode === 'tickets') {
      if (!operationRows?.length && !workRows?.length) {
        return NextResponse.json({ error: '请上传含操作票、工作票两个工作表的 Excel' }, { status: 400 });
      }
      const ticketResult = await aggregateTicketsForImport(prisma, {
        year: year ?? new Date().getFullYear(),
        sourceFile: 'preview',
        operationRows: operationRows ?? [],
        workRows: workRows ?? [],
        unitFilter,
      });

      const previewRows = ticketResult.aggregates.slice(0, 20).map((agg) => ({
        工号: agg.employeeNo,
        姓名: agg.employeeName,
        原始分: agg.rawScore,
        操作票分: agg.breakdown.operationPoints,
        负责人分: agg.breakdown.workLeaderPoints,
        许可人分: agg.breakdown.workPermitterPoints,
      }));

      return NextResponse.json({
        success: true,
        kind: 'ticket-aggregate',
        stats: ticketResult.stats,
        unmatchedTotal: ticketResult.unmatchedNames.length,
        unmatched: ticketResult.unmatchedNames.slice(0, 30),
        rows: previewRows,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: '无数据行' }, { status: 400 });
    }

    // defects / safety
    const dimMap = {
      defects: 'worksite.defect-governance',
      safety: 'performance.safety-contribution',
    } as const;
    const dimensionCode = dimMap[itemCode as 'defects' | 'safety'];
    const rule = await loadRule(dimensionCode);
    const inputs = rowsToFactInputs(dimensionCode, mapping as unknown as FactFieldMapping, rows.slice(0, 20));
    const scored = computeFactScores(inputs, [rule]);
    return NextResponse.json({
      success: true,
      kind: 'score',
      rows: scored.map((s) => ({ employeeNo: s.employeeNo, score: s.score })),
    });
  } catch (e) {
    console.error('POST /api/admin/import/preview:', e);
    const message = e instanceof Error ? e.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
