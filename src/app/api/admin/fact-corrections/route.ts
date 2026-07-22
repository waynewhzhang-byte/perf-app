export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { factKindForDimension, recalculateFactBackedSubmission } from '@/lib/fact-correction';
import { loadBasicFactTiers } from '@/lib/basic-fact-import';
import { scorePerformanceLevel, scoreSkillLevel, scoreTitleLevel } from '@/lib/basic-quality';
import { computeFactScores, type ScoringRule } from '@/lib/scoring-engine';
import { sourceDimensionCodes } from '@/lib/scoring-standards';
import {
  buildDerivedFactCorrection,
  isDerivedFactCorrectionDimension,
} from '@/lib/fact-correction-performance';

const BasicDimensionByCode = {
  'basic.skill-level': 'SKILL_LEVEL',
  'basic.title-level': 'TITLE_LEVEL',
  'basic.performance-level': 'PERFORMANCE_LEVEL',
} as const;

const PayloadSchema = z.object({
  submissionItemId: z.string(),
  factId: z.string().optional(),
  kind: z.enum(['BASIC', 'PERFORMANCE']),
  reason: z.string().min(1),
  evidenceNote: z.string().optional(),
  tierValue: z.string().optional(),
  yearBreakdown: z.record(z.string(), z.string().nullable()).optional(),
  role: z.enum(['FIRST_DISCOVERER', 'CO_DISCOVERER', 'FIRST_HANDLER', 'CO_HANDLER']).optional(),
  eventType: z.enum(['DISCOVERY', 'REMEDIATION']).optional(),
  defectLevel: z.string().optional(),
  defectRef: z.string().optional(),
  eventDate: z.string().optional(),
  rawScore: z.number().min(0).optional(),
  incidentId: z.string().optional(),
  faultCount: z.number().int().min(1).optional(),
  subtype: z.string().optional(),
  award: z.string().optional(),
  level: z.string().optional(),
  project: z.string().optional(),
  category: z.string().optional(),
  violationLevel: z.string().optional(),
  violationRole: z.string().optional(),
  description: z.string().optional(),
});

async function loadEligibleItem(submissionItemId: string) {
  const item = await prisma.submissionItem.findUnique({
    where: { id: submissionItemId },
    include: {
      item: true,
      submission: { include: { user: true, template: true } },
    },
  });
  if (!item) throw new Error('申报项不存在');
  if (!item.isSystemFilled || item.confirmationStatus !== 'DISPUTED' || item.disputeL2Result !== 'APPROVED') {
    throw new Error('仅能修正二审已确认有效的系统事实申诉项');
  }
  const kind = factKindForDimension(item.item.dimensionCode ?? '');
  if (!kind) throw new Error('该评分项暂不支持事实修正');
  if (!item.submission.user.employeeNo) throw new Error('员工缺少工号，无法修正事实');
  return { item, kind };
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const submissionId = new URL(req.url).searchParams.get('submissionId');
    if (!submissionId) return NextResponse.json({ error: '缺少 submissionId' }, { status: 400 });

    const items = await prisma.submissionItem.findMany({
      where: {
        submissionId,
        isSystemFilled: true,
        confirmationStatus: 'DISPUTED',
        disputeL2Result: 'APPROVED',
      },
      include: { item: true, factCorrections: { orderBy: { correctedAt: 'desc' } } },
    });
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { user: { select: { employeeNo: true, fullName: true } }, template: { select: { year: true } } },
    });
    if (!submission?.user.employeeNo) return NextResponse.json({ error: '申报或员工不存在' }, { status: 404 });
    const employeeNo = submission.user.employeeNo;

    const basicDimensions = [...new Set(items.flatMap((item) => {
      const dimensionCode = item.item.dimensionCode ?? '';
      const kind = factKindForDimension(dimensionCode);
      const dimension = kind === 'BASIC'
        ? BasicDimensionByCode[dimensionCode as keyof typeof BasicDimensionByCode]
        : undefined;
      return dimension ? [dimension] : [];
    }))];
    const performanceDimensionCodes = [...new Set(items.flatMap((item) => {
      const dimensionCode = item.item.dimensionCode ?? '';
      return factKindForDimension(dimensionCode) === 'PERFORMANCE'
        ? sourceDimensionCodes(dimensionCode)
        : [];
    }))];
    const [basicFacts, performanceFacts] = await Promise.all([
      prisma.employeeBasicFact.findMany({
        where: { year: submission.template.year, employeeNo, dimension: { in: basicDimensions } },
      }),
      prisma.performanceFact.findMany({
        where: { year: submission.template.year, employeeNo, dimensionCode: { in: performanceDimensionCodes } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const details = items.map((item) => {
      const dimensionCode = item.item.dimensionCode ?? '';
      const kind = factKindForDimension(dimensionCode);
      if (!kind) return null;
      const facts = kind === 'BASIC'
        ? basicFacts.filter((fact) => fact.dimension === BasicDimensionByCode[dimensionCode as keyof typeof BasicDimensionByCode])
        : performanceFacts.filter((fact) => sourceDimensionCodes(dimensionCode).includes(fact.dimensionCode));
      return { item, kind, facts };
    }).filter((detail): detail is NonNullable<typeof detail> => detail !== null);
    return NextResponse.json({ success: true, employee: submission.user, year: submission.template.year, items: details });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '服务器内部错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const parsed = PayloadSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数无效', issues: parsed.error.issues }, { status: 400 });
    const input = parsed.data;
    const { item, kind } = await loadEligibleItem(input.submissionItemId);
    if (input.kind !== kind) return NextResponse.json({ error: '事实类型与评分项不匹配' }, { status: 400 });
    const { user, template } = item.submission;
    const dimensionCode = item.item.dimensionCode!;
    let beforeData: unknown = null;
    let afterData: unknown;
    let factId: string;
    let action: 'CREATE' | 'UPDATE';

    if (kind === 'BASIC') {
      const dimension = BasicDimensionByCode[dimensionCode as keyof typeof BasicDimensionByCode];
      if (!dimension || !input.tierValue?.trim()) return NextResponse.json({ error: '请填写事实档位' }, { status: 400 });
      const existing = input.factId
        ? await prisma.employeeBasicFact.findUnique({ where: { id: input.factId } })
        : await prisma.employeeBasicFact.findUnique({ where: { year_employeeNo_dimension: { year: template.year, employeeNo: user.employeeNo!, dimension } } });
      if (existing && (existing.year !== template.year || existing.employeeNo !== user.employeeNo || existing.dimension !== dimension)) {
        return NextResponse.json({ error: '事实记录不属于当前员工和评分项' }, { status: 400 });
      }
      const tiers = await loadBasicFactTiers(prisma);
      const breakdown = input.yearBreakdown ?? {};
      const score = dimension === 'SKILL_LEVEL'
        ? scoreSkillLevel(input.tierValue, tiers.skill)
        : dimension === 'TITLE_LEVEL'
          ? scoreTitleLevel(input.tierValue, tiers.title)
          : scorePerformanceLevel([breakdown['2023'] ?? null, breakdown['2024'] ?? null, breakdown['2025'] ?? null], tiers.performance).score;
      const data = {
        year: template.year, employeeNo: user.employeeNo!, employeeName: user.fullName, userId: user.id,
        dimension, tierValue: input.tierValue, yearBreakdown: dimension === 'PERFORMANCE_LEVEL' ? breakdown : undefined,
        score, sourceFile: existing?.sourceFile ?? `appeal-correction:${item.submissionId}`,
      };
      beforeData = existing;
      action = existing ? 'UPDATE' : 'CREATE';
      const fact = existing
        ? await prisma.employeeBasicFact.update({ where: { id: existing.id }, data })
        : await prisma.employeeBasicFact.create({ data });
      factId = fact.id;
      afterData = fact;
    } else {
      const existing = input.factId ? await prisma.performanceFact.findUnique({ where: { id: input.factId } }) : null;
      if (existing && (
        existing.year !== template.year
        || existing.employeeNo !== user.employeeNo
        || !sourceDimensionCodes(dimensionCode).includes(existing.dimensionCode)
      )) {
        return NextResponse.json({ error: '事实记录不属于当前员工和评分项' }, { status: 400 });
      }
      const sourceFile = existing?.sourceFile ?? `appeal-correction:${item.submissionId}`;
      let data;
      if (isDerivedFactCorrectionDimension(dimensionCode)) {
        const seed = buildDerivedFactCorrection({
          dimensionCode,
          year: template.year,
          employeeNo: user.employeeNo!,
          employeeName: user.fullName,
          sourceFile,
          existing,
          subtype: input.subtype,
          award: input.award,
          level: input.level,
          project: input.project,
          category: input.category,
          violationLevel: input.violationLevel,
          violationRole: input.violationRole,
          description: input.description,
          eventDate: input.eventDate,
        });
        data = {
          year: template.year, employeeNo: user.employeeNo!, employeeName: user.fullName, userId: user.id,
          dimensionCode: seed.dimensionCode, dimensionTitle: seed.dimensionTitle, role: seed.role, eventType: seed.eventType,
          score: seed.score, defectRef: seed.defectRef, defectLevel: seed.defectLevel, eventDate: seed.eventDate,
          sourceFile, metadata: { ...seed.metadata, correctedByAppeal: true },
        };
      } else {
        if (!input.defectRef?.trim()) return NextResponse.json({ error: '请填写事实编号或标识' }, { status: 400 });
        const ruleRow = await prisma.scoringRule.findUnique({ where: { dimensionCode } });
        if (!ruleRow?.enabled) return NextResponse.json({ error: '该维度未配置可用评分规则' }, { status: 400 });
        const rule: ScoringRule = { id: ruleRow.id, dimensionCode, ruleType: ruleRow.ruleType as ScoringRule['ruleType'], cap: Number(ruleRow.cap), enabled: ruleRow.enabled, ...(ruleRow.config as object) };
        const metadata = { ...(existing?.metadata as object ?? {}), incidentId: input.incidentId, faultCount: input.faultCount, rawScore: input.rawScore, correctedByAppeal: true };
        const [scored] = computeFactScores([{
          employeeNo: user.employeeNo!, employeeName: user.fullName, dimensionCode,
          role: input.role ?? existing?.role ?? 'FIRST_DISCOVERER', eventType: input.eventType ?? existing?.eventType ?? 'DISCOVERY',
          defectLevel: input.defectLevel ?? existing?.defectLevel, defectRef: input.defectRef,
          eventDate: input.eventDate ?? existing?.eventDate ?? undefined, sourceFile,
          incidentId: input.incidentId, faultCount: input.faultCount, rawScore: input.rawScore, metadata,
        }], [rule]);
        if (!scored) return NextResponse.json({ error: '该事实不能按当前规则计分，请补全必要字段' }, { status: 400 });
        data = {
          year: template.year, employeeNo: user.employeeNo!, employeeName: user.fullName, userId: user.id,
          dimensionCode, dimensionTitle: item.item.title, role: scored.role, eventType: scored.eventType,
          score: scored.score, defectRef: scored.defectRef ?? input.defectRef, defectLevel: scored.defectLevel ?? '', eventDate: scored.eventDate ?? null,
          sourceFile, metadata,
        };
      }
      beforeData = existing;
      action = existing ? 'UPDATE' : 'CREATE';
      const fact = existing
        ? await prisma.performanceFact.update({ where: { id: existing.id }, data })
        : await prisma.performanceFact.create({ data });
      factId = fact.id;
      afterData = fact;
    }

    await prisma.factCorrection.create({
      data: { submissionItemId: item.id, kind, action, factId, beforeData: beforeData as object ?? undefined, afterData: afterData as object, reason: input.reason, evidenceNote: input.evidenceNote, correctedBy: session.userId },
    });
    const recalculated = await recalculateFactBackedSubmission(prisma, item.submissionId);
    return NextResponse.json({ success: true, totalScore: recalculated.totalScore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '服务器内部错误' }, { status: 500 });
  }
}
