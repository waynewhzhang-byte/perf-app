import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { normalizePersonName } from '@/lib/employee-resolver';
import type { DeclarationTier } from '@/lib/quantitative-report';
import { TICKET_EXECUTION_DIMENSION } from '@/lib/evaluation-dimensions';

export interface TicketExecutionEntry {
  unit: string;
  employeeNo: string;
  fullName: string;
  rewardTotal: number;
  rawScore: number;
}

export interface TicketExecutionImportResult {
  sourceFile: string;
  sheetName: string;
  unit: string;
  entries: TicketExecutionEntry[];
  byName: Map<string, TicketExecutionEntry>;
  byEmployeeNo: Map<string, TicketExecutionEntry>;
}

const SUMMARY_SHEET_NAMES = ['统计表', '统计'];
const HEADER_MARKERS = ['单位', '工号', '姓名'];

function cellString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function cellNumber(value: unknown): number {
  const s = cellString(value);
  if (!s || s === '/' || s === '#DIV/0!' || s === '#REF!') return 0;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
}

function findSummarySheet(wb: XLSX.WorkBook): { name: string; matrix: unknown[][] } {
  for (const name of SUMMARY_SHEET_NAMES) {
    if (wb.SheetNames.includes(name)) {
      return { name, matrix: sheetToMatrix(wb.Sheets[name]!) };
    }
  }
  const fallback = wb.SheetNames[2] ?? wb.SheetNames[0];
  if (!fallback) throw new Error('两票公示汇总中未找到「统计表」工作表');
  return { name: fallback, matrix: sheetToMatrix(wb.Sheets[fallback]!) };
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i] ?? [];
    if (
      cellString(row[0]) === HEADER_MARKERS[0] &&
      cellString(row[1]) === HEADER_MARKERS[1] &&
      cellString(row[2]) === HEADER_MARKERS[2]
    ) {
      return i;
    }
  }
  throw new Error('统计表缺少「单位 / 工号 / 姓名」表头行');
}

function findColumnIndex(headerRow: unknown[], label: string): number {
  const idx = headerRow.findIndex((c) => cellString(c) === label);
  if (idx < 0) throw new Error(`统计表缺少「${label}」列`);
  return idx;
}

export function parseTicketSummaryMatrix(
  matrix: unknown[][],
  options: { unit?: string; sourceFile?: string; sheetName?: string } = {},
): TicketExecutionImportResult {
  const unitFilter = options.unit ?? '变电检修中心';
  const headerIdx = findHeaderRow(matrix);
  const headerRow = matrix[headerIdx] ?? [];
  const unitCol = findColumnIndex(headerRow, '单位');
  const noCol = findColumnIndex(headerRow, '工号');
  const nameCol = findColumnIndex(headerRow, '姓名');
  const totalCol = findColumnIndex(headerRow, '总计');
  const scoreCol = findColumnIndex(headerRow, '分数');

  const entries: TicketExecutionEntry[] = [];
  const byName = new Map<string, TicketExecutionEntry>();
  const byEmployeeNo = new Map<string, TicketExecutionEntry>();

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const unit = cellString(row[unitCol]);
    const employeeNo = cellString(row[noCol]);
    const fullName = cellString(row[nameCol]);
    if (!unit || !employeeNo || !fullName) continue;
    if (unit !== unitFilter) continue;

    const entry: TicketExecutionEntry = {
      unit,
      employeeNo,
      fullName,
      rewardTotal: cellNumber(row[totalCol]),
      rawScore: cellNumber(row[scoreCol]),
    };
    entries.push(entry);
    byName.set(normalizePersonName(fullName), entry);
    byEmployeeNo.set(employeeNo, entry);
  }

  entries.sort((a, b) => b.rawScore - a.rawScore || a.fullName.localeCompare(b.fullName, 'zh-CN'));

  return {
    sourceFile: options.sourceFile ?? '',
    sheetName: options.sheetName ?? '统计表',
    unit: unitFilter,
    entries,
    byName,
    byEmployeeNo,
  };
}

export function loadTicketExecutionFromFile(
  filePath: string,
  unit = '变电检修中心',
): TicketExecutionImportResult {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const { name, matrix } = findSummarySheet(wb);
  return parseTicketSummaryMatrix(matrix, { unit, sourceFile: filePath, sheetName: name });
}

export function roundTicketScore(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 暂行稿：本专业（此处按能级）内最高分 = 满分 30，其余按比例折算 */
export function scaleTicketScoreByTier(
  rawScore: number,
  tierMaxRaw: number,
  maxScore = TICKET_EXECUTION_DIMENSION.maxScore,
): number {
  if (rawScore <= 0 || tierMaxRaw <= 0) return 0;
  return roundTicketScore(Math.min(maxScore, (rawScore / tierMaxRaw) * maxScore));
}

export function computeTierMaxRawScores(
  rows: { tier: DeclarationTier; rawTicketScore: number }[],
): Record<DeclarationTier, number> {
  const max: Record<DeclarationTier, number> = { 一级: 0, 二级: 0, 三级: 0 };
  for (const row of rows) {
    if (row.rawTicketScore > max[row.tier]) max[row.tier] = row.rawTicketScore;
  }
  return max;
}

export interface TicketScaledRow {
  tier: DeclarationTier;
  rawTicketScore: number;
  ticketExecution: number;
  ticketTierMaxRaw: number;
}

export function applyTicketExecutionByTier<T extends TicketScaledRow>(rows: T[]): T[] {
  const tierMax = computeTierMaxRawScores(rows);
  return rows.map((row) => ({
    ...row,
    ticketTierMaxRaw: tierMax[row.tier],
    ticketExecution: scaleTicketScoreByTier(row.rawTicketScore, tierMax[row.tier]),
  }));
}

export function mergeTicketRawScores<
  T extends { fullName: string; rawTicketScore: number; ticketExecution: number; ticketTierMaxRaw: number },
>(rows: T[], ticketImport: TicketExecutionImportResult): T[] {
  return rows.map((row) => {
    const hit = ticketImport.byName.get(normalizePersonName(row.fullName));
    return {
      ...row,
      rawTicketScore: hit?.rawScore ?? 0,
      ticketExecution: 0,
      ticketTierMaxRaw: 0,
    };
  });
}
