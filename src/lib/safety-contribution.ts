import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { parseYear } from '@/lib/defect-governance';
import { normalizePersonName } from '@/lib/employee-resolver';
import {
  SAFETY_CONTRIBUTION_DIMENSION,
  type EvaluationDimensionCode,
} from '@/lib/evaluation-dimensions';
import type { NameResolver } from '@/lib/defect-governance';

export type SafetyContributionRole = 'FIRST_DISCOVERER' | 'CO_DISCOVERER';

export interface SafetyContributionRow {
  ref: string;
  declareUnit: string;
  reason: string;
  declareDate: string;
  employeeNo: string;
  fullName: string;
  unit: string;
  team: string;
  amount: number;
  isFirstDiscoverer: boolean;
}

export interface SafetyContributionFactLine {
  dimensionCode: EvaluationDimensionCode;
  dimensionTitle: string;
  year: number;
  employeeNo: string;
  employeeName: string;
  role: SafetyContributionRole;
  score: number;
  incidentRef: string;
  eventDate: string | null;
  metadata: {
    reason: string;
    declareUnit: string;
    unit: string;
    team: string;
    amount: number;
    faultCount: number;
    isFirstDiscoverer: boolean;
  };
}

export interface EmployeeSafetyAggregate {
  employeeNo: string;
  employeeName: string;
  dimensionCode: EvaluationDimensionCode;
  dimensionTitle: string;
  year: number;
  rawScore: number;
  cappedScore: number;
  factCount: number;
  facts: SafetyContributionFactLine[];
}

export interface SafetyContributionImportResult {
  dimension: typeof SAFETY_CONTRIBUTION_DIMENSION;
  sourceFile: string;
  sheetName: string;
  unit: string;
  year: number;
  filterNote: string;
  entries: SafetyContributionRow[];
  facts: SafetyContributionFactLine[];
  byEmployee: EmployeeSafetyAggregate[];
  byName: Map<string, EmployeeSafetyAggregate>;
  unmatchedNames: { name: string; occurrences: number; sampleRefs: string[] }[];
}

const DETAIL_SHEET_NAMES = ['申报奖励明细', '申报明细'];
const DIMENSION_CODE = SAFETY_CONTRIBUTION_DIMENSION.code;
const DIMENSION_TITLE = SAFETY_CONTRIBUTION_DIMENSION.title;

/** 安全贡献计分参数（来自 ScoringRule.config；DB 无配置时回退默认） */
export interface SafetyScoreConfig {
  /** 子项封顶分 */
  cap: number;
  /** 分组键字段名（固定 incidentId，即申报编号） */
  groupBy: 'incidentId';
  /** 各角色计分规则 */
  roles: {
    FIRST_DISCOVERER: { perIncident: number; multiplyByFaultCount: boolean };
    CO_DISCOVERER: { totalShare: number; multiplyByFaultCount: boolean; splitAmong: string };
  };
}

/** 默认计分参数（与《2025量化积分表》及 defaultScoringRuleConfigs 同源） */
export const DEFAULT_SAFETY_SCORE_CONFIG: SafetyScoreConfig = {
  cap: SAFETY_CONTRIBUTION_DIMENSION.maxScore,
  groupBy: 'incidentId',
  roles: {
    FIRST_DISCOVERER: { perIncident: 3, multiplyByFaultCount: true },
    CO_DISCOVERER: { totalShare: 3, multiplyByFaultCount: true, splitAmong: 'CO_DISCOVERER' },
  },
};

function cellString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function cellNumber(value: unknown): number {
  const s = cellString(value);
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 事由中「N处故障」按 N 次计分（与报送表示例一致，如刘涛 2 处 → 6 分） */
export function parseFaultCountFromReason(reason: string): number {
  const m = reason.match(/(\d+)处故障/);
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function findDetailSheet(wb: XLSX.WorkBook): { name: string; matrix: unknown[][] } {
  for (const name of DETAIL_SHEET_NAMES) {
    if (wb.SheetNames.includes(name)) {
      return {
        name,
        matrix: XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, defval: '', raw: false }) as unknown[][],
      };
    }
  }
  throw new Error('突出贡献奖明细中未找到「申报奖励明细」工作表');
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i] ?? [];
    if (cellString(row[6]) === '姓名' && cellString(row[10]).includes('第一发现')) {
      return i;
    }
  }
  throw new Error('申报奖励明细缺少表头行（姓名 / 是否第一发现人）');
}

export function parseSafetyContributionMatrix(
  matrix: unknown[][],
  options: { year?: number; unit?: string; sourceFile?: string; sheetName?: string } = {},
): Omit<SafetyContributionImportResult, 'dimension'> {
  const year = options.year ?? 2024;
  // 不再按单位过滤（工号已在 col[5]，员工基本信息表提供部门映射）。
  // unit 仅作为记录字段保留在返回结构里（向后兼容），不再影响导入范围。
  const unit = options.unit ?? '';
  const headerIdx = findHeaderRow(matrix);
  const entries: SafetyContributionRow[] = [];

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const ref = cellString(row[1]);
    const fullName = cellString(row[6]);
    if (!ref || !fullName) continue;

    const declareDate = cellString(row[4]);
    const rowYear = parseYear(declareDate);
    if (rowYear !== year) continue;

    entries.push({
      ref,
      declareUnit: cellString(row[2]),
      reason: cellString(row[3]),
      declareDate,
      employeeNo: cellString(row[5]),
      fullName,
      unit: cellString(row[7]),
      team: cellString(row[8]),
      amount: cellNumber(row[9]),
      isFirstDiscoverer: cellString(row[10]) === '是',
    });
  }

  return {
    sourceFile: options.sourceFile ?? '',
    sheetName: options.sheetName ?? '申报奖励明细',
    unit,
    year,
    filterNote:
      `评价年度 ${year}：按「申报时间」年份过滤；全量导入（不按单位过滤）。` +
      `人员匹配走工号（col[5] 员工编号），部门信息取自员工基本信息表。` +
      `计分按申报编号分组：` +
      `第一发现人 ${DEFAULT_SAFETY_SCORE_CONFIG.roles.FIRST_DISCOVERER.perIncident} 分/次（事由含 N 处故障时按 N 次）；` +
      `其他发现人合计 ${DEFAULT_SAFETY_SCORE_CONFIG.roles.CO_DISCOVERER.totalShare} 分/次并在其他发现人之间均分；子项封顶 ${DEFAULT_SAFETY_SCORE_CONFIG.cap} 分。`,
    entries,
    facts: [],
    byEmployee: [],
    byName: new Map(),
    unmatchedNames: [],
  };
}

export function scoreSafetyContributionEntries(
  entries: SafetyContributionRow[],
  year: number,
  configOrResolver?: SafetyScoreConfig | NameResolver,
  resolverMaybe?: NameResolver,
): Pick<SafetyContributionImportResult, 'facts' | 'byEmployee' | 'byName' | 'unmatchedNames'> {
  // 兼容两种调用：scoreSafetyContributionEntries(entries, year, config?, resolver?)
  // 也兼容旧签名 scoreSafetyContributionEntries(entries, year, resolver)
  let config: SafetyScoreConfig;
  let resolver: NameResolver | null;
  if (configOrResolver && typeof configOrResolver === 'object' && 'roles' in configOrResolver) {
    config = configOrResolver;
    resolver = resolverMaybe ?? null;
  } else if (configOrResolver && typeof configOrResolver === 'object' && 'resolve' in configOrResolver) {
    config = DEFAULT_SAFETY_SCORE_CONFIG;
    resolver = configOrResolver;
  } else {
    config = DEFAULT_SAFETY_SCORE_CONFIG;
    resolver = null;
  }

  const byRef = new Map<string, SafetyContributionRow[]>();
  for (const entry of entries) {
    const list = byRef.get(entry.ref) ?? [];
    list.push(entry);
    byRef.set(entry.ref, list);
  }

  const facts: SafetyContributionFactLine[] = [];
  const unmatchedMap = new Map<string, { count: number; refs: Set<string> }>();

  for (const [incidentRef, people] of byRef) {
    const reason = people[0]?.reason ?? '';
    const faultCount = parseFaultCountFromReason(reason);
    const firstBase = config.roles.FIRST_DISCOVERER.perIncident;
    const firstMul = config.roles.FIRST_DISCOVERER.multiplyByFaultCount ? faultCount : 1;
    const firstPoints = firstBase * firstMul;
    const coBase = config.roles.CO_DISCOVERER.totalShare;
    const coMul = config.roles.CO_DISCOVERER.multiplyByFaultCount ? faultCount : 1;
    const coShareBase = coBase * coMul;

    const firstPeople = people.filter((p) => p.isFirstDiscoverer);
    const otherPeople = people.filter((p) => !p.isFirstDiscoverer);
    const otherShare = otherPeople.length > 0 ? coShareBase / otherPeople.length : 0;

    const lines: { row: SafetyContributionRow; role: SafetyContributionRole; score: number }[] = [
      ...firstPeople.map((row) => ({ row, role: 'FIRST_DISCOVERER' as const, score: firstPoints })),
      ...otherPeople.map((row) => ({ row, role: 'CO_DISCOVERER' as const, score: otherShare })),
    ];

    for (const line of lines) {
      // 工号优先（col[5] 已携带）；若调用方传入 resolver 且工号缺失则回退姓名匹配
      let employeeNo = line.row.employeeNo;
      let employeeName = line.row.fullName;
      if (!employeeNo && resolver) {
        const resolved = resolver.resolve(line.row.fullName);
        if (!resolved) {
          const bucket = unmatchedMap.get(line.row.fullName) ?? { count: 0, refs: new Set<string>() };
          bucket.count += 1;
          bucket.refs.add(incidentRef);
          unmatchedMap.set(line.row.fullName, bucket);
          continue;
        }
        employeeNo = resolved.employeeNo;
        employeeName = resolved.employeeName;
      }
      if (!employeeNo) {
        const bucket = unmatchedMap.get(line.row.fullName) ?? { count: 0, refs: new Set<string>() };
        bucket.count += 1;
        bucket.refs.add(incidentRef);
        unmatchedMap.set(line.row.fullName, bucket);
        continue;
      }

      facts.push({
        dimensionCode: DIMENSION_CODE,
        dimensionTitle: DIMENSION_TITLE,
        year,
        employeeNo,
        employeeName,
        role: line.role,
        score: roundScore(line.score),
        incidentRef,
        eventDate: line.row.declareDate || null,
        metadata: {
          reason: line.row.reason,
          declareUnit: line.row.declareUnit,
          unit: line.row.unit,
          team: line.row.team,
          amount: line.row.amount,
          faultCount,
          isFirstDiscoverer: line.row.isFirstDiscoverer,
        },
      });
    }
  }

  const byEmployeeMap = new Map<string, EmployeeSafetyAggregate>();
  for (const fact of facts) {
    const agg =
      byEmployeeMap.get(fact.employeeNo) ??
      ({
        employeeNo: fact.employeeNo,
        employeeName: fact.employeeName,
        dimensionCode: DIMENSION_CODE,
        dimensionTitle: DIMENSION_TITLE,
        year,
        rawScore: 0,
        cappedScore: 0,
        factCount: 0,
        facts: [],
      } satisfies EmployeeSafetyAggregate);
    agg.rawScore += fact.score;
    agg.factCount += 1;
    agg.facts.push(fact);
    byEmployeeMap.set(fact.employeeNo, agg);
  }

  const byEmployee = [...byEmployeeMap.values()]
    .map((agg) => ({
      ...agg,
      rawScore: roundScore(agg.rawScore),
      cappedScore: roundScore(Math.min(agg.rawScore, config.cap)),
      facts: agg.facts.sort((a, b) => a.incidentRef.localeCompare(b.incidentRef)),
    }))
    .sort((a, b) => b.cappedScore - a.cappedScore || a.employeeName.localeCompare(b.employeeName, 'zh-CN'));

  const byName = new Map<string, EmployeeSafetyAggregate>();
  for (const agg of byEmployee) {
    byName.set(normalizePersonName(agg.employeeName), agg);
  }

  const unmatchedNames = [...unmatchedMap.entries()]
    .map(([name, v]) => ({
      name,
      occurrences: v.count,
      sampleRefs: [...v.refs].slice(0, 5),
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return { facts, byEmployee, byName, unmatchedNames };
}

export function importSafetyContributionFacts(
  parsed: Pick<
    SafetyContributionImportResult,
    'entries' | 'sourceFile' | 'sheetName' | 'unit' | 'filterNote'
  >,
  year: number,
  resolveName: NameResolver,
): SafetyContributionImportResult {
  const scored = scoreSafetyContributionEntries(parsed.entries, year, resolveName);
  return {
    dimension: SAFETY_CONTRIBUTION_DIMENSION,
    year,
    sourceFile: parsed.sourceFile,
    sheetName: parsed.sheetName,
    unit: parsed.unit,
    filterNote: parsed.filterNote,
    entries: parsed.entries,
    ...scored,
  };
}

export function loadSafetyContributionFromFile(
  filePath: string,
  options: { year?: number; unit?: string } = {},
): SafetyContributionImportResult {
  const year = options.year ?? 2024;
  const unit = options.unit ?? '';
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const { name, matrix } = findDetailSheet(wb);
  const parsed = parseSafetyContributionMatrix(matrix, { year, unit, sourceFile: filePath, sheetName: name });
  return {
    dimension: SAFETY_CONTRIBUTION_DIMENSION,
    ...parsed,
  };
}

export function collectPersonNamesFromContributionEntries(entries: SafetyContributionRow[]): string[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const key = normalizePersonName(entry.fullName);
    if (key && !seen.has(key)) seen.set(key, entry.fullName);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function mergeSafetyScores<T extends { fullName: string; safetyContribution: number; rawSafetyScore: number; safetyFactCount: number }>(
  rows: T[],
  safetyImport: SafetyContributionImportResult,
): T[] {
  return rows.map((row) => {
    const hit = safetyImport.byName.get(normalizePersonName(row.fullName));
    return {
      ...row,
      safetyContribution: hit?.cappedScore ?? 0,
      rawSafetyScore: hit?.rawScore ?? 0,
      safetyFactCount: hit?.factCount ?? 0,
    };
  });
}
