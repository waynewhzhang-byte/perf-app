import type { BasicDimension, PrismaClient } from '@prisma/client';
import {
  buildPerformanceScoreSheet,
  type PerformanceScoreSheet,
  type ScoreSheetInput,
} from '@/lib/performance-score-sheet';
import {
  formatPerformanceFactRecord,
  type FactRecordView,
} from '@/lib/fact-record-view';
import {
  evaluationCutoffDate,
  type DeclarationTier,
} from '@/lib/declaration-level';
import { loadTicketSpecialtyMaxRaw } from '@/lib/performance-score-sheet';
import { round1 } from '@/lib/rounding';
import {
  isAppealSupplementSourceFile,
} from '@/lib/submission-fact-persistence';

export interface ArchivedBasicFact {
  id: string;
  dimension: BasicDimension;
  tierValue: string;
  yearBreakdown: unknown;
  score: number;
  sourceFile: string;
}

export interface ArchivedPerformanceFact {
  id: string;
  dimensionCode: string;
  dimensionTitle: string;
  score: number;
  role: string;
  eventType: string;
  defectRef: string;
  defectLevel: string;
  eventDate: string | null;
  sourceFile: string;
  metadata: unknown;
  record: FactRecordView;
}

export interface ArchivedSubmissionFact {
  id: string;
  dimensionCode: string;
  dimensionTitle: string;
  label: string;
  unitScore: number;
  count: number;
  score: number;
  content: string | null;
  sourceFile: string;
}

export interface ArchivedProfileFact {
  id: string;
  dimensionCode: 'profile.hire-date';
  dimensionTitle: '参加工作时间';
  value: string;
  score: 0;
  sourceFile: string;
}

export interface FinalFactSnapshot {
  version: 1;
  captureMode:
    | 'FINAL_REVIEW'
    | 'REBUILT_CURRENT_FACTS'
    | 'REBUILT_VERIFIED';
  capturedAt: string;
  manualReview?: {
    reviewedAt: string;
    reviewedBy: string;
    note: string;
  };
  employee: {
    employeeNo: string;
    employeeName: string;
    workAreaId: string | null;
    workAreaName: string | null;
    departmentId: string | null;
    departmentName: string | null;
    declarationLevelId: string | null;
    declarationLevelName: string | null;
    declarationSpecialtyId: string | null;
    declarationSpecialtyName: string | null;
  };
  profileFacts: ArchivedProfileFact[];
  basicFacts: ArchivedBasicFact[];
  performanceFacts: ArchivedPerformanceFact[];
  submissionFacts: ArchivedSubmissionFact[];
  scoreSheet: PerformanceScoreSheet;
  reconciliation: {
    archivedTotalScore: number;
    recalculatedTotalScore: number;
    difference: number;
    status: 'MATCHED' | 'MANUAL_REVIEW';
  };
}

export interface BuildFinalFactSnapshotInput {
  capturedAt: Date;
  captureMode?: FinalFactSnapshot['captureMode'];
  archivedTotalScore: number;
  employee: FinalFactSnapshot['employee'];
  year: number;
  hireDate: Date | null;
  templateItems: ScoreSheetInput['templateItems'];
  submissionItems: ScoreSheetInput['submissionItems'];
  basicFacts: Array<ArchivedBasicFact>;
  performanceFacts: Array<ArchivedPerformanceFact>;
  submissionFacts: Array<ArchivedSubmissionFact>;
  ticketCohortMax: number;
}

export function buildFinalFactSnapshot(
  input: BuildFinalFactSnapshotInput,
): FinalFactSnapshot {
  const scoringSubmissionFacts = input.submissionFacts.filter(
    (fact) => !isAppealSupplementSourceFile(fact.sourceFile),
  );
  const scoreSheet = buildPerformanceScoreSheet({
    year: input.year,
    employeeNo: input.employee.employeeNo,
    employeeName: input.employee.employeeName,
    declarationTier:
      input.employee.declarationLevelName as DeclarationTier | null,
    hireDate: input.hireDate,
    evaluationDate: evaluationCutoffDate(input.year),
    templateItems: input.templateItems,
    submissionItems: input.submissionItems,
    basicFacts: input.basicFacts,
    performanceFacts: input.performanceFacts.map((fact) => ({
      id: fact.id,
      dimensionCode: fact.dimensionCode,
      score: fact.score,
      role: fact.role,
      defectRef: fact.defectRef,
      defectLevel: fact.defectLevel,
      eventType: fact.eventType,
      metadata: fact.metadata,
      sourceFile: fact.sourceFile,
      recordKey: fact.record.recordKey,
      recordType: fact.record.recordType,
      recordTitle: fact.record.title,
      participationRole: fact.record.roleLabel,
      sourceSheet: fact.record.source.sheet,
      sourceRowNo: fact.record.source.rowNo,
    })),
    submissionFacts: scoringSubmissionFacts,
    ticketCohortMax: input.ticketCohortMax,
  });
  const difference = round1(
    scoreSheet.totalScore - input.archivedTotalScore,
  );
  const captureMode = input.captureMode ?? 'FINAL_REVIEW';
  const profileFacts: ArchivedProfileFact[] = input.hireDate
    ? [{
        id: 'profile-hire-date',
        dimensionCode: 'profile.hire-date',
        dimensionTitle: '参加工作时间',
        value: input.hireDate.toISOString().slice(0, 10),
        score: 0,
        sourceFile: '1.能级评价员工花名册.xlsx',
      }]
    : [];

  return {
    version: 1,
    captureMode,
    capturedAt: input.capturedAt.toISOString(),
    employee: input.employee,
    profileFacts,
    basicFacts: input.basicFacts,
    performanceFacts: input.performanceFacts,
    submissionFacts: input.submissionFacts,
    scoreSheet,
    reconciliation: {
      archivedTotalScore: round1(input.archivedTotalScore),
      recalculatedTotalScore: round1(scoreSheet.totalScore),
      difference,
      status: captureMode === 'FINAL_REVIEW' && Math.abs(difference) <= 0.01
        ? 'MATCHED'
        : 'MANUAL_REVIEW',
    },
  };
}

type SnapshotClient = Pick<
  PrismaClient,
  | 'submission'
  | 'employeeBasicFact'
  | 'performanceFact'
  | 'submissionDimensionFact'
  | 'user'
>;

export async function captureFinalFactSnapshot(
  prisma: SnapshotClient,
  input: {
    submissionId: string;
    archivedTotalScore: number;
    capturedAt: Date;
    captureMode?: FinalFactSnapshot['captureMode'];
  },
): Promise<FinalFactSnapshot | null> {
  const submission = await prisma.submission.findUnique({
    where: { id: input.submissionId },
    include: {
      user: {
        select: {
          employeeNo: true,
          fullName: true,
          branch: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      },
      template: {
        select: {
          year: true,
          sections: {
            orderBy: { sortOrder: 'asc' },
            select: {
              items: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  id: true,
                  title: true,
                  dimensionCode: true,
                  scoreMode: true,
                  maxScore: true,
                  scoreOptions: true,
                  maxSelections: true,
                },
              },
            },
          },
        },
      },
      items: {
        select: {
          itemId: true,
          score: true,
          selected: true,
          isSystemFilled: true,
          confirmationStatus: true,
          overrideScore: true,
        },
      },
    },
  });
  if (!submission?.user.employeeNo) return null;

  const employeeNo = submission.user.employeeNo;
  const year = submission.template.year;
  const [basicRows, performanceRows, submissionRows, ticketCohortMax] =
    await Promise.all([
      prisma.employeeBasicFact.findMany({
        where: { year, employeeNo },
        orderBy: { dimension: 'asc' },
      }),
      prisma.performanceFact.findMany({
        where: { year, employeeNo },
        orderBy: [
          { dimensionCode: 'asc' },
          { eventDate: 'asc' },
          { sourceFile: 'asc' },
          { sourceRowNo: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
      prisma.submissionDimensionFact.findMany({
        where: { submissionId: submission.id },
        orderBy: [
          { dimensionCode: 'asc' },
          { submissionItemId: 'asc' },
          { optionId: 'asc' },
        ],
      }),
      loadTicketSpecialtyMaxRaw(
        prisma,
        year,
        submission.workAreaName ?? submission.user.branch?.name ?? null,
      ),
    ]);

  const basicFacts: ArchivedBasicFact[] = basicRows.map((fact) => ({
    id: fact.id,
    dimension: fact.dimension,
    tierValue: fact.tierValue,
    yearBreakdown: fact.yearBreakdown,
    score: Number(fact.score),
    sourceFile: fact.sourceFile,
  }));
  const performanceFacts: ArchivedPerformanceFact[] = performanceRows.map(
    (fact) => ({
      id: fact.id,
      dimensionCode: fact.dimensionCode,
      dimensionTitle: fact.dimensionTitle,
      score: Number(fact.score),
      role: fact.role,
      eventType: fact.eventType,
      defectRef: fact.defectRef,
      defectLevel: fact.defectLevel,
      eventDate: fact.eventDate,
      sourceFile: fact.sourceFile,
      metadata: fact.metadata,
      record: formatPerformanceFactRecord({
        ...fact,
        score: Number(fact.score),
      }),
    }),
  );
  const submissionFacts: ArchivedSubmissionFact[] = submissionRows.map(
    (fact) => ({
      id: fact.id,
      dimensionCode: fact.dimensionCode,
      dimensionTitle: fact.dimensionTitle,
      label: fact.label,
      unitScore: Number(fact.unitScore),
      count: fact.count,
      score: Number(fact.score),
      content: fact.content,
      sourceFile: fact.sourceFile,
    }),
  );

  return buildFinalFactSnapshot({
    capturedAt: input.capturedAt,
    captureMode: input.captureMode,
    archivedTotalScore: input.archivedTotalScore,
    employee: {
      employeeNo,
      employeeName: submission.user.fullName,
      workAreaId: submission.branchId ?? submission.user.branch?.id ?? null,
      workAreaName:
        submission.workAreaName ?? submission.user.branch?.name ?? null,
      departmentId: submission.user.department?.id ?? null,
      departmentName: submission.user.department?.name ?? null,
      declarationLevelId: submission.declarationLevelId,
      declarationLevelName: submission.declarationLevelName,
      declarationSpecialtyId: submission.declarationSpecialtyId,
      declarationSpecialtyName: submission.declarationSpecialtyName,
    },
    year,
    hireDate: submission.hireDate,
    templateItems: submission.template.sections.flatMap(
      (section) => section.items.map((item) => ({
        ...item,
        maxScore: item.maxScore == null ? null : Number(item.maxScore),
      })),
    ),
    submissionItems: submission.items.map((item) => ({
      itemId: item.itemId,
      score: Number(item.score),
      selected: item.selected,
      isSystemFilled: item.isSystemFilled,
      confirmationStatus: item.confirmationStatus,
      overrideScore:
        item.overrideScore == null ? null : Number(item.overrideScore),
    })),
    basicFacts,
    performanceFacts,
    submissionFacts,
    ticketCohortMax,
  });
}

export function readFinalFactSnapshot(
  archivedData: unknown,
): FinalFactSnapshot | null {
  if (!archivedData || typeof archivedData !== 'object' || Array.isArray(archivedData)) {
    return null;
  }
  const snapshot = (archivedData as { factSnapshot?: unknown }).factSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }
  const candidate = snapshot as Partial<FinalFactSnapshot>;
  return candidate.version === 1
    && Array.isArray(candidate.profileFacts)
    && Array.isArray(candidate.performanceFacts)
    && Array.isArray(candidate.basicFacts)
    && Array.isArray(candidate.submissionFacts)
    && candidate.scoreSheet != null
    ? candidate as FinalFactSnapshot
    : null;
}

export function finalFactSnapshotApprovalError(
  snapshot: FinalFactSnapshot | null,
): string | null {
  if (!snapshot) {
    return '终审事实快照生成失败，申报缺少可归档的员工事实身份';
  }
  if (snapshot.reconciliation.status === 'MANUAL_REVIEW') {
    return `事实重算分与终审分不一致（差额 ${snapshot.reconciliation.difference} 分），请人工复核后再终审`;
  }
  return null;
}
