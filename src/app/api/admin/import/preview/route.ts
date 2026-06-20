export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { previewBasicFacts } from '@/lib/import-preview';
import { loadBasicFactTiers, type BasicFactFieldMapping } from '@/lib/basic-fact-import';
import { rowsToFactInputs, type FactFieldMapping } from '@/lib/manual-fact-import';
import { computeFactScores, type ScoringRule } from '@/lib/scoring-engine';

const BodySchema = z.object({
  itemCode: z.enum(['employees', 'basic', 'tickets', 'defects', 'safety']),
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.string())).min(1),
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

    const { itemCode, mapping, rows } = parsed.data;

    if (itemCode === 'employees') {
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
      const tiers = await loadBasicFactTiers(prisma);
      const preview = previewBasicFacts(mapping as unknown as BasicFactFieldMapping, rows.slice(0, 20), tiers);
      return NextResponse.json({ success: true, kind: 'score', rows: preview });
    }

    // tickets / defects / safety
    const dimMap = {
      tickets: 'worksite.ticket-execution',
      defects: 'worksite.defect-governance',
      safety: 'performance.safety-contribution',
    } as const;
    const dimensionCode = dimMap[itemCode as 'tickets' | 'defects' | 'safety'];
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
