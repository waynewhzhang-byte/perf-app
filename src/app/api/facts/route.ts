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
import { loadPerformanceScoreSheet, loadTicketSpecialtyMaxRaw } from '@/lib/performance-score-sheet';
import { sourceDimensionCodes, sourceDimensionTitle } from '@/lib/scoring-standards';
import { effectiveHireDate } from '@/lib/declaration-level';
import {
  extractSystemFilledFromSheet,
  HIRE_DATE_CONFIRMATION_CODE,
  isFactDataSourceDimension,
  resolveFormItemDimension,
} from '@/lib/system-filled-items';
import { buildDerivation, type DerivationInputFact } from '@/lib/fact-derivation';
import { formatPerformanceFactRecord, type FactRecordView } from '@/lib/fact-record-view';
import { loadScoringStandardOverrides } from '@/lib/scoring-standard-text';

function withoutRawMetadata<T extends { rawFactFields: DerivationInputFact[] }>(derivation: T): T {
  return {
    ...derivation,
    rawFactFields: derivation.rawFactFields.map(({ metadata: _metadata, ...fact }) => fact),
  };
}

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
    select: { employeeNo: true, hireDate: true, profile: true, branch: { select: { name: true } } },
  });

  // 两票折算基准：同专业原始分最高值（仅两票维度需要，其他维度传入 undefined 忽略）
  const ticketCohortMax = await loadTicketSpecialtyMaxRaw(prisma, template.year, user?.branch?.name);

  // 规则说明文案覆盖（纯展示，不影响分数）；按年度加载一次，传给 buildDerivation
  const displayOverrides = await loadScoringStandardOverrides(prisma, template.year);

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
          orderBy: [
            { dimensionCode: 'asc' },
            { eventDate: 'asc' },
            { sourceFile: 'asc' },
            { sourceRowNo: 'asc' },
            { createdAt: 'asc' },
          ],
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
        const basicRecord: FactRecordView | undefined = fact ? {
          id: fact.id,
          recordKey: `${template.year}:${fact.employeeNo}:${fact.dimension}`,
          recordType: 'BASIC_FACT',
          title: dim ? BASIC_DIMENSION_LABELS[dim] : code,
          score: Number(fact.score),
          details: [
            { label: '认定档位', value: fact.tierValue },
            ...Object.entries(
              fact.yearBreakdown && typeof fact.yearBreakdown === 'object'
                ? fact.yearBreakdown as Record<string, unknown>
                : {},
            ).map(([year, value]) => ({ label: `${year} 年考核`, value: String(value) })),
          ],
          source: { ...(fact.sourceFile ? { file: fact.sourceFile } : {}) },
        } : undefined;
        const basicDerivationFacts: DerivationInputFact[] = fact ? [{
          id: fact.id,
          tierValue: fact.tierValue ?? undefined,
          score: Number(fact.score),
          label: dim ? BASIC_DIMENSION_LABELS[dim] : code,
          thirdLevelTitle: sourceDimensionTitle(code),
          yearBreakdown: fact.yearBreakdown,
          sourceFile: fact.sourceFile ?? undefined,
          record: basicRecord,
        } as DerivationInputFact] : [];
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
              record: basicRecord,
            },
          ] : [],
          totalScore: sys.score,
          // overrideScore 暂不接入（填报页展示当前事实推算；已存在 override 需额外查 SubmissionItem，留作后续接入点）
          derivation: buildDerivation(code, basicDerivationFacts, { finalScore: sys.score }, displayOverrides.get(code)) ?? undefined,
        };
      }

      const facts = perfFacts.filter((f) => sourceDimensionCodes(code).includes(f.dimensionCode));
      const recordByFactId = new Map(facts.map((f) => [
        f.id,
        formatPerformanceFactRecord(f),
      ]));
      const perfDerivationFacts: DerivationInputFact[] = facts.map((f) => ({
          id: f.id,
          score: Number(f.score),
          role: f.role ?? undefined,
          defectRef: f.defectRef ?? undefined,
          defectLevel: f.defectLevel ?? undefined,
          eventDate: f.eventDate,
          label: f.dimensionTitle || f.dimensionCode,
          thirdLevelTitle: sourceDimensionTitle(f.dimensionCode),
          metadata: f.metadata,
          sourceFile: f.sourceFile ?? undefined,
          record: recordByFactId.get(f.id),
        } satisfies DerivationInputFact));
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
          sourceFile: f.sourceFile,
          record: recordByFactId.get(f.id),
        })),
        totalScore: sys.score,
        // overrideScore 暂不接入（填报页展示当前事实推算；已存在 override 需额外查 SubmissionItem，留作后续接入点）
        derivation: (() => {
          const derivation = buildDerivation(
            code,
            perfDerivationFacts,
            { finalScore: sys.score, ticketCohortMax },
            displayOverrides.get(code),
          );
          return derivation ? withoutRawMetadata(derivation) : undefined;
        })(),
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
    ruleSummary: '参加工作时间来自员工花名册；系统据此按年度截止日计算工龄和参评能级（不可申诉）。',
    requiresConfirmation: false,
    facts: hireDate ? [{
      id: 'profile-hire-date',
      thirdLevelTitle: '参加工作时间',
      label: hireDate.toISOString().slice(0, 10),
      score: 0,
      sourceFile: '1.能级评价员工花名册.xlsx',
      record: {
        id: 'profile-hire-date',
        recordKey: `profile:${template.year}:hire-date`,
        recordType: 'PROFILE_FACT',
        title: '参加工作时间',
        score: 0,
        details: [{ label: '参加工作时间', value: hireDate.toISOString().slice(0, 10) }],
        source: { file: '1.能级评价员工花名册.xlsx' },
      } satisfies FactRecordView,
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
      sections: sheet.sections.map((section) => ({
        code: section.code,
        title: section.title,
        score: section.score,
        maxScore: section.maxScore,
      })),
    },
  });
}
