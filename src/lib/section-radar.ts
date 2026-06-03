import { prisma } from '@/lib/prisma';
import {
  computeSectionScores,
  computeTemplateMaxScore,
  type ScorableSection,
  type SectionScoreRow,
} from '@/lib/score-calculation';

export interface SectionRadarData {
  year: number;
  templateTitle: string;
  submissionId: string;
  totalScore: number;
  templateMaxScore: number;
  sections: SectionScoreRow[];
}

type ArchivedItem = {
  itemId: string;
  score: number | string;
};

type ArchivedPayload = {
  submissionId?: string;
  templateId?: string;
  items?: ArchivedItem[];
  sections?: SectionScoreRow[];
  templateMaxScore?: number;
};

function scoreMapFromItems(items: { itemId: string; score: unknown }[]) {
  const map = new Map<string, number>();
  for (const it of items) {
    map.set(it.itemId, Number(it.score));
  }
  return map;
}

async function loadTemplateSections(templateId: string): Promise<ScorableSection[]> {
  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          sortOrder: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              scoreMode: true,
              maxScore: true,
              maxSelections: true,
              scoreOptions: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  });
  if (!template) return [];
  return template.sections.map((sec) => ({
    id: sec.id,
    title: sec.title,
    sortOrder: sec.sortOrder,
    items: sec.items.map((it) => ({
      id: it.id,
      scoreMode: it.scoreMode,
      maxScore: it.maxScore != null ? Number(it.maxScore) : null,
      maxSelections: it.maxSelections,
      scoreOptions: it.scoreOptions,
      sortOrder: it.sortOrder,
    })),
  }));
}

function sectionsFromArchive(
  archived: ArchivedPayload,
  templateSections: ScorableSection[],
  totalScore: number,
): SectionScoreRow[] {
  if (archived.sections && archived.sections.length > 0) {
    return [...archived.sections].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const items = archived.items ?? [];
  const scoreByItemId = scoreMapFromItems(items);
  return computeSectionScores(templateSections, scoreByItemId);
}

export async function buildRadarFromPerformanceRecord(recordId: string): Promise<SectionRadarData | null> {
  const record = await prisma.performanceRecord.findUnique({
    where: { id: recordId },
    include: {
      user: { select: { id: true } },
    },
  });
  if (!record) return null;

  const archived = record.archivedData as ArchivedPayload;
  const templateId = archived.templateId;
  if (!templateId) return null;

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { title: true, year: true },
  });
  if (!template) return null;

  const templateSections = await loadTemplateSections(templateId);
  const sections = sectionsFromArchive(archived, templateSections, Number(record.totalScore));
  const templateMaxScore =
    archived.templateMaxScore != null
      ? Number(archived.templateMaxScore)
      : computeTemplateMaxScore(templateSections);

  return {
    year: record.year,
    templateTitle: template.title,
    submissionId: record.submissionId,
    totalScore: Number(record.totalScore),
    templateMaxScore,
    sections,
  };
}

export async function buildRadarFromSubmission(submissionId: string): Promise<SectionRadarData | null> {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      template: { select: { id: true, title: true, year: true } },
      items: { select: { itemId: true, score: true } },
    },
  });
  if (!sub || sub.status !== 'L2_APPROVED') return null;

  const record = await prisma.performanceRecord.findUnique({
    where: { submissionId: sub.id },
  });

  if (record) {
    return buildRadarFromPerformanceRecord(record.id);
  }

  const templateSections = await loadTemplateSections(sub.templateId);
  const scoreByItemId = scoreMapFromItems(sub.items);
  const sections = computeSectionScores(templateSections, scoreByItemId);

  return {
    year: sub.template.year,
    templateTitle: sub.template.title,
    submissionId: sub.id,
    totalScore: Number(sub.totalScore),
    templateMaxScore: computeTemplateMaxScore(templateSections),
    sections,
  };
}
