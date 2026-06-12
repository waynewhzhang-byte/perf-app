import type { DefectImportResult, DefectFactLine, DefectRow } from '@/lib/defect-governance';
import { fakePersonalInfo } from '@/lib/random-roster';
import {
  applyTicketExecutionByTier,
  mergeTicketRawScores,
  type TicketExecutionImportResult,
} from '@/lib/ticket-execution';
import {
  mergeSafetyScores,
  type SafetyContributionFactLine,
  type SafetyContributionImportResult,
} from '@/lib/safety-contribution';

export type DeclarationTier = '一级' | '二级' | '三级';

export interface QuantitativeReportRow {
  seq: number;
  employeeNo: string;
  fullName: string;
  gender: string;
  unit: string;
  specialty: string;
  position: string;
  workYears: string;
  skillLevel: number;
  titleLevel: number;
  performanceLevel: number;
  safetyContribution: number;
  technicalStandard: number;
  technicalResource: number;
  competitionEvent: number;
  competitionExam: number;
  innovationAward: number;
  innovationPaper: number;
  ticketExecution: number;
  defectGovernance: number;
  violationSevere: number;
  violationGeneral: number;
  tier: DeclarationTier;
  rawDefectScore: number;
  rawSafetyScore: number;
  rawTicketScore: number;
  ticketTierMaxRaw: number;
  factCount: number;
  safetyFactCount: number;
}

export interface SafetyDetailExportRow {
  employeeNo: string;
  employeeName: string;
  dimensionTitle: string;
  role: string;
  itemScore: number;
  incidentRef: string;
  eventDate: string | null;
  reason: string;
  declareUnit: string;
  unit: string;
  faultCount: number;
}

export interface DefectDetailExportRow {
  employeeNo: string;
  employeeName: string;
  dimensionTitle: string;
  role: string;
  eventType: string;
  itemScore: number;
  defectRef: string;
  defectLevel: string;
  eventDate: string | null;
  sourceRow: DefectRow;
}

export interface QuantitativeReportBundle {
  year: number;
  reportTitleYear: number;
  unit: string;
  defectImport: DefectImportResult;
  ticketImport?: TicketExecutionImportResult;
  safetyImport?: SafetyContributionImportResult;
  ticketScalingNote: string;
  rows: QuantitativeReportRow[];
  byTier: Record<DeclarationTier, QuantitativeReportRow[]>;
  detailRows: DefectDetailExportRow[];
  safetyDetailRows: SafetyDetailExportRow[];
  rosterCsvPath: string;
}

function assignTier(cappedScore: number): DeclarationTier {
  if (cappedScore >= 10) return '二级';
  if (cappedScore >= 3) return '三级';
  if (cappedScore > 0) return '一级';
  return '一级';
}

function emptyReportRow(
  employeeNo: string,
  fullName: string,
  unit: string,
  defectGovernance: number,
  rawDefectScore: number,
  factCount: number,
): QuantitativeReportRow {
  const personal = fakePersonalInfo(employeeNo, fullName);
  return {
    seq: 0,
    employeeNo,
    fullName,
    gender: personal.gender,
    unit,
    specialty: personal.specialty,
    position: personal.position,
    workYears: personal.workYears,
    skillLevel: 0,
    titleLevel: 0,
    performanceLevel: 0,
    safetyContribution: 0,
    technicalStandard: 0,
    technicalResource: 0,
    competitionEvent: 0,
    competitionExam: 0,
    innovationAward: 0,
    innovationPaper: 0,
    ticketExecution: 0,
    defectGovernance,
    violationSevere: 0,
    violationGeneral: 0,
    tier: assignTier(defectGovernance),
    rawDefectScore,
    rawSafetyScore: 0,
    rawTicketScore: 0,
    ticketTierMaxRaw: 0,
    factCount,
    safetyFactCount: 0,
  };
}

export function buildQuantitativeReportRows(
  defectImport: DefectImportResult,
  options: {
    unit?: string;
    includeZeroScore?: boolean;
    safetyImport?: SafetyContributionImportResult;
  } = {},
): QuantitativeReportRow[] {
  const unit = options.unit ?? '变电检修中心';
  const includeZero = options.includeZeroScore ?? false;
  const safetyImport = options.safetyImport;

  const rowByEmployeeNo = new Map<string, QuantitativeReportRow>();

  for (const e of defectImport.byEmployee) {
    if (!includeZero && e.cappedScore <= 0) continue;
    rowByEmployeeNo.set(
      e.employeeNo,
      emptyReportRow(e.employeeNo, e.employeeName, unit, e.cappedScore, e.rawScore, e.factCount),
    );
  }

  if (safetyImport) {
    for (const e of safetyImport.byEmployee) {
      if (e.cappedScore <= 0) continue;
      if (rowByEmployeeNo.has(e.employeeNo)) continue;
      rowByEmployeeNo.set(
        e.employeeNo,
        emptyReportRow(e.employeeNo, e.employeeName, unit, 0, 0, 0),
      );
    }
  }

  let rows = [...rowByEmployeeNo.values()].sort(
    (a, b) =>
      b.defectGovernance - a.defectGovernance ||
      b.safetyContribution - a.safetyContribution ||
      a.fullName.localeCompare(b.fullName, 'zh-CN'),
  );

  if (safetyImport) {
    rows = mergeSafetyScores(rows, safetyImport);
  }

  return rows.map((r, i) => ({ ...r, seq: i + 1 }));
}

export function groupRowsByTier(rows: QuantitativeReportRow[]): Record<DeclarationTier, QuantitativeReportRow[]> {
  const tiers: Record<DeclarationTier, QuantitativeReportRow[]> = {
    一级: [],
    二级: [],
    三级: [],
  };
  for (const row of rows) {
    tiers[row.tier].push(row);
  }
  for (const key of Object.keys(tiers) as DeclarationTier[]) {
    tiers[key] = tiers[key].map((r, i) => ({ ...r, seq: i + 1 }));
  }
  return tiers;
}

export function buildDefectDetailRows(
  defectRows: DefectRow[],
  facts: DefectFactLine[],
): DefectDetailExportRow[] {
  const rowByRef = new Map<string, DefectRow>();
  for (const row of defectRows) {
    const ref = String(row.编号 ?? '').trim();
    if (ref) rowByRef.set(ref, row);
  }

  return facts
    .map((fact) => ({
      employeeNo: fact.employeeNo,
      employeeName: fact.employeeName,
      dimensionTitle: fact.dimensionTitle,
      role: fact.role,
      eventType: fact.eventType,
      itemScore: fact.score,
      defectRef: fact.defectRef,
      defectLevel: fact.defectLevel,
      eventDate: fact.eventDate,
      sourceRow: rowByRef.get(fact.defectRef) ?? { 编号: fact.defectRef, 等级: fact.defectLevel },
    }))
    .sort(
      (a, b) =>
        a.employeeNo.localeCompare(b.employeeNo) ||
        a.defectRef.localeCompare(b.defectRef) ||
        a.role.localeCompare(b.role),
    );
}

const TICKET_SCALING_NOTE =
  '两票执行：读取统计表「分数」列为原始分；在同一能级（一级/二级/三级）内，该能级最高分折算为 30 分，其余人员按比例折算。';

export function buildSafetyDetailRows(facts: SafetyContributionFactLine[]): SafetyDetailExportRow[] {
  return facts
    .map((fact) => ({
      employeeNo: fact.employeeNo,
      employeeName: fact.employeeName,
      dimensionTitle: fact.dimensionTitle,
      role: fact.role,
      itemScore: fact.score,
      incidentRef: fact.incidentRef,
      eventDate: fact.eventDate,
      reason: fact.metadata.reason,
      declareUnit: fact.metadata.declareUnit,
      unit: fact.metadata.unit,
      faultCount: fact.metadata.faultCount,
    }))
    .sort(
      (a, b) =>
        a.employeeNo.localeCompare(b.employeeNo) ||
        a.incidentRef.localeCompare(b.incidentRef) ||
        a.role.localeCompare(b.role),
    );
}

export function buildQuantitativeReportBundle(
  defectImport: DefectImportResult,
  defectRows: DefectRow[],
  options: {
    year: number;
    reportTitleYear?: number;
    unit?: string;
    rosterCsvPath: string;
    ticketImport?: TicketExecutionImportResult;
    safetyImport?: SafetyContributionImportResult;
  },
): QuantitativeReportBundle {
  const safetyImport = options.safetyImport;
  let rows = buildQuantitativeReportRows(defectImport, {
    unit: options.unit,
    safetyImport,
  });
  const ticketImport = options.ticketImport;

  if (ticketImport) {
    rows = applyTicketExecutionByTier(mergeTicketRawScores(rows, ticketImport));
  }

  return {
    year: options.year,
    reportTitleYear: options.reportTitleYear ?? options.year + 1,
    unit: options.unit ?? '变电检修中心',
    defectImport,
    ticketImport,
    safetyImport,
    ticketScalingNote: ticketImport ? TICKET_SCALING_NOTE : '',
    rows,
    byTier: groupRowsByTier(rows),
    detailRows: buildDefectDetailRows(defectRows, defectImport.facts),
    safetyDetailRows: safetyImport ? buildSafetyDetailRows(safetyImport.facts) : [],
    rosterCsvPath: options.rosterCsvPath,
  };
}
