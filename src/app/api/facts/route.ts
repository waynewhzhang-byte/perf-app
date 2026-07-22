/**
 * 获取当前用户在指定模板下的系统填充事实数据 + 绩效分表维度得分。
 *
 * GET /api/facts?templateId=xxx
 */
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import {
  basicDimensionFromCode,
  BASIC_DIMENSION_LABELS,
  isBasicDimensionCode,
} from '@/lib/basic-dimension-map';
import { loadPerformanceScoreSheet } from '@/lib/performance-score-sheet';
import { sourceDimensionCodes, sourceDimensionTitle } from '@/lib/scoring-standards';
import { effectiveHireDate } from '@/lib/declaration-level';
import {
  extractSystemFilledFromSheet,
  HIRE_DATE_CONFIRMATION_CODE,
  isFactDataSourceDimension,
  resolveFormItemDimension,
} from '@/lib/system-filled-items';

export async function GET(req: Request) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const templateId = new URL(req.url).searchParams.get('templateId');
  if (!templateId) return NextResponse.json({ error: '缺少 templateId' }, { status: 400 });

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { year: true, title: true },
  });
  if (!template) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

  const sections = await prisma.formSection.findMany({
    where: { templateId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  const sheet = await loadPerformanceScoreSheet({
    prisma,
    year: template.year,
    employeeNo: '',
    templateId,
    userId: s.userId,
  });

  if (!sheet) {
    return NextResponse.json({ success: true, items: [], scoreSheet: null });
  }

  const systemRows = extractSystemFilledFromSheet(sheet);
  const systemByItemId = new Map(systemRows.map((r) => [r.itemId, r]));

  const user = await prisma.user.findUnique({
    where: { id: s.userId },
    select: { employeeNo: true, hireDate: true, profile: true },
  });

  const factBoundItems = sections.flatMap((sec) =>
    sec.items
      .map((it) => ({ item: it, section: sec, dimensionCode: resolveFormItemDimension(it) }))
      .filter(({ dimensionCode }) => isFactDataSourceDimension(dimensionCode)),
  );

  const perfCodes = factBoundItems
    .map(({ dimensionCode }) => dimensionCode!)
    .filter((c) => !isBasicDimensionCode(c))
    .flatMap((code) => sourceDimensionCodes(code));
  const basicCodes = factBoundItems
    .map(({ dimensionCode }) => dimensionCode!)
    .filter((c) => isBasicDimensionCode(c));

  const [perfFacts, basicFacts] = await Promise.all([
    user?.employeeNo && perfCodes.length
      ? prisma.performanceFact.findMany({
          where: {
            year: template.year,
            employeeNo: user.employeeNo,
            dimensionCode: { in: perfCodes },
          },
        })
      : [],
    user?.employeeNo && basicCodes.length
      ? prisma.employeeBasicFact.findMany({
          where: {
            year: template.year,
            employeeNo: user.employeeNo,
            dimension: {
              in: basicCodes
                .map((c) => basicDimensionFromCode(c))
                .filter((d): d is NonNullable<typeof d> => d != null),
            },
          },
        })
      : [],
  ]);

  const items = factBoundItems
    .map(({ item, section, dimensionCode }) => {
      const code = dimensionCode!;
      const sys = systemByItemId.get(item.id);
      if (!sys) return null;

      if (isBasicDimensionCode(code)) {
        const dim = basicDimensionFromCode(code);
        const fact = basicFacts.find((f) => f.dimension === dim);
        return {
          itemId: item.id,
          itemTitle: item.title,
          sectionTitle: section.title,
          sectionCode: section.sectionCode,
          dimensionCode: code,
          scoreMode: item.scoreMode,
          maxScore: item.maxScore,
          factKind: 'basic' as const,
          source: 'FACT' as const,
          ruleSummary: sys.ruleSummary,
          requiresConfirmation: true,
          facts: fact ? [
            {
              id: fact.id,
              thirdLevelTitle: sourceDimensionTitle(code),
              tierValue: fact.tierValue,
              label: dim ? BASIC_DIMENSION_LABELS[dim] : code,
              yearBreakdown: fact.yearBreakdown,
              score: Number(fact.score),
            },
          ] : [],
          totalScore: sys.score,
        };
      }

      const facts = perfFacts.filter((f) => sourceDimensionCodes(code).includes(f.dimensionCode));
      return {
        itemId: item.id,
        itemTitle: item.title,
        sectionTitle: section.title,
        sectionCode: section.sectionCode,
        dimensionCode: code,
        scoreMode: item.scoreMode,
        maxScore: item.maxScore,
        factKind: 'performance' as const,
        source: 'FACT' as const,
        ruleSummary: sys.ruleSummary,
        requiresConfirmation: true,
        facts: facts.map((f) => ({
          id: f.id,
          thirdLevelTitle: sourceDimensionTitle(f.dimensionCode),
          label: f.dimensionTitle || f.dimensionCode,
          role: f.role,
          eventType: f.eventType,
          score: Number(f.score),
          defectRef: f.defectRef,
          defectLevel: f.defectLevel,
          eventDate: f.eventDate,
          metadata: f.metadata,
          sourceFile: f.sourceFile,
        })),
        totalScore: sys.score,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const hireDateItem = sections
    .flatMap((section) => section.items.map((item) => ({ section, item })))
    .find(({ item }) => item.dimensionCode === HIRE_DATE_CONFIRMATION_CODE);
  const hireDate = user ? effectiveHireDate(user.hireDate, user.profile) : null;
  const profileItems = hireDateItem ? [{
    itemId: hireDateItem.item.id,
    itemTitle: hireDateItem.item.title,
    sectionTitle: hireDateItem.section.title,
    sectionCode: hireDateItem.section.sectionCode,
    dimensionCode: HIRE_DATE_CONFIRMATION_CODE,
    factKind: 'profile' as const,
    source: 'FACT' as const,
    ruleSummary: '参加工作时间来自员工花名册；系统据此按年度截止日计算工龄和参评能级。',
    requiresConfirmation: true,
    facts: hireDate ? [{
      id: 'profile-hire-date',
      thirdLevelTitle: '参加工作时间',
      label: hireDate.toISOString().slice(0, 10),
      score: 0,
      sourceFile: '1.能级评价员工花名册.xlsx',
    }] : [],
    totalScore: 0,
  }] : [];

  return NextResponse.json({
    success: true,
    items: [...profileItems, ...items],
    scoreSheet: {
      totalScore: sheet.totalScore,
      positiveScore: sheet.positiveScore,
      deductionScore: sheet.deductionScore,
      positiveMaxScore: sheet.positiveMaxScore,
      declarationTier: sheet.declarationTier,
    },
  });
}
