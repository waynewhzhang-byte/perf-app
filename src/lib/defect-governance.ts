import {
  DEFECT_LIBRARY_DIMENSION,
  type EvaluationDimensionCode,
} from '@/lib/evaluation-dimensions';

export type DefectLevel = '危急' | '严重' | '一般';

export type DefectFactRole =
  | 'FIRST_DISCOVERER'
  | 'CO_DISCOVERER'
  | 'FIRST_HANDLER'
  | 'CO_HANDLER';

export interface DefectRow {
  编号: string;
  等级: string;
  发现人?: string | number | null;
  消缺人?: string | number | null;
  发现时间?: string | number | null;
  消缺时间?: string | number | null;
  消除时间?: string | number | null;
  问题状态?: string | number | null;
  所属类别?: string | number | null;
  变电站?: string | number | null;
  问题描述?: string | number | null;
  责任单位?: string | number | null;
  [key: string]: string | number | null | undefined;
}

export interface DefectImportOptions {
  /** 仅导入所属类别为「缺陷」的记录（默认 true，符合评分标准） */
  requireDefectCategory?: boolean;
  /** 视为已消缺的状态（默认 已消除 + 已闭环） */
  remediatedStatuses?: string[];
}

export interface DefectFactLine {
  dimensionCode: EvaluationDimensionCode;
  dimensionTitle: string;
  year: number;
  employeeNo: string;
  employeeName: string;
  role: DefectFactRole;
  score: number;
  defectRef: string;
  defectLevel: DefectLevel;
  eventType: 'DISCOVERY' | 'REMEDIATION';
  eventDate: string | null;
  metadata: {
    substation: string | null;
    description: string | null;
    responsibleUnit: string | null;
    status: string | null;
    /** 是否为共同发现/共同处理（限 1 人） */
    isCollaborative: boolean;
    /** 原始人员字段（分拆前） */
    rawPersonField: string | null;
    /** 分拆序号：0=第一人，1=共同人 */
    personIndex: number;
    category: string | null;
  };
}

export interface EmployeeDimensionAggregate {
  employeeNo: string;
  employeeName: string;
  dimensionCode: EvaluationDimensionCode;
  dimensionTitle: string;
  year: number;
  rawScore: number;
  cappedScore: number;
  factCount: number;
  facts: DefectFactLine[];
}

export interface DefectImportResult {
  dimension: typeof DEFECT_LIBRARY_DIMENSION;
  year: number;
  filterNote: string;
  totalDefectRows: number;
  rowsWithDiscoveryCredit: number;
  rowsWithRemediationCredit: number;
  facts: DefectFactLine[];
  byEmployee: EmployeeDimensionAggregate[];
  unmatchedNames: { name: string; occurrences: number; sampleDefectRefs: string[] }[];
}

/** 角色 × 缺陷等级 → 单价（来自 ScoringRule.config.matrix，默认值与《2025量化积分表》一致） */
export type DefectScoreMatrix = Record<
  DefectLevel,
  Partial<Record<DefectFactRole, number>>
>;

/** 默认矩阵（DB 无规则时回退；与 defaultScoringRuleConfigs 的 defect 配置一致） */
export const DEFAULT_DEFECT_SCORE_MATRIX: DefectScoreMatrix = {
  危急: { FIRST_DISCOVERER: 3, CO_DISCOVERER: 1, FIRST_HANDLER: 3, CO_HANDLER: 1 },
  严重: { FIRST_DISCOVERER: 1, CO_DISCOVERER: 0.5, FIRST_HANDLER: 1, CO_HANDLER: 0.5 },
  一般: { FIRST_DISCOVERER: 0.5, FIRST_HANDLER: 0.5 },
};

const DIMENSION_CODE = DEFECT_LIBRARY_DIMENSION.code;
const DIMENSION_TITLE = DEFECT_LIBRARY_DIMENSION.title;
const DIMENSION_CAP = DEFECT_LIBRARY_DIMENSION.maxScore;

export function parsePersonList(raw: string | number | null | undefined): string[] {
  if (raw == null) return [];
  const text = String(raw)
    .replace(/[·•]/g, '')
    .replace(/[，、,;；]/g, ',')
    .replace(/\s+/g, ',');
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseYear(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

function normalizeLevel(raw: string | number | null | undefined): DefectLevel | null {
  const s = String(raw ?? '').trim();
  if (s === '危急' || s === '危机') return '危急';
  if (s === '严重') return '严重';
  if (s === '一般') return '一般';
  return null;
}

function roleLines(
  people: string[],
  level: DefectLevel,
  kind: 'discover' | 'handle',
  matrix: DefectScoreMatrix,
): { role: DefectFactRole; name: string; score: number; personIndex: number; isCollaborative: boolean }[] {
  if (people.length === 0) return [];
  const levelMatrix = matrix[level] ?? {};
  // 共同人是否计分：该等级为共同发现/处理人配置了正分才产出
  const coDiscovererScore = levelMatrix.CO_DISCOVERER ?? 0;
  const coHandlerScore = levelMatrix.CO_HANDLER ?? 0;
  const [first, ...rest] = people;
  const lines: ReturnType<typeof roleLines> = [];

  if (kind === 'discover') {
    lines.push({
      role: 'FIRST_DISCOVERER',
      name: first,
      score: levelMatrix.FIRST_DISCOVERER ?? 0,
      personIndex: 0,
      isCollaborative: false,
    });
    if (coDiscovererScore > 0 && rest[0]) {
      lines.push({
        role: 'CO_DISCOVERER',
        name: rest[0],
        score: coDiscovererScore,
        personIndex: 1,
        isCollaborative: true,
      });
    }
  } else {
    lines.push({
      role: 'FIRST_HANDLER',
      name: first,
      score: levelMatrix.FIRST_HANDLER ?? 0,
      personIndex: 0,
      isCollaborative: false,
    });
    if (coHandlerScore > 0 && rest[0]) {
      lines.push({
        role: 'CO_HANDLER',
        name: rest[0],
        score: coHandlerScore,
        personIndex: 1,
        isCollaborative: true,
      });
    }
  }
  return lines;
}

function isDefectCategory(row: DefectRow, requireDefectCategory: boolean): boolean {
  if (!requireDefectCategory) return true;
  const cat = String(row.所属类别 ?? '').trim();
  return cat === '缺陷';
}

function remediationTime(row: DefectRow): string | number | null | undefined {
  return row.消缺时间 ?? row.消除时间;
}

function isRemediated(status: string | number | null | undefined, allowed: string[]): boolean {
  const s = String(status ?? '').trim();
  return allowed.includes(s);
}

type ProvisionalDefectLine = {
  role: DefectFactRole;
  name: string;
  score: number;
  eventType: 'DISCOVERY' | 'REMEDIATION';
  eventDate: string | null;
  personIndex: number;
  isCollaborative: boolean;
  rawPersonField: string;
};

/** 同一缺陷、同一人兼发现与处理：只保留较高分的一条事实 */
function dedupeSamePersonOnDefect(lines: ProvisionalDefectLine[]): ProvisionalDefectLine[] {
  const byName = new Map<string, (typeof lines)[number]>();
  for (const line of lines) {
    const prev = byName.get(line.name);
    if (!prev || line.score > prev.score) byName.set(line.name, line);
  }
  return [...byName.values()];
}

export interface NameResolver {
  resolve(name: string): { employeeNo: string; employeeName: string } | null;
}

export function buildFactsFromDefectRows(
  rows: DefectRow[],
  year: number,
  resolveName: NameResolver,
  options: DefectImportOptions = {},
  scoreMatrix: DefectScoreMatrix = DEFAULT_DEFECT_SCORE_MATRIX,
): Omit<DefectImportResult, 'dimension' | 'filterNote' | 'unmatchedNames'> & {
  unmatchedNameMap: Map<string, { count: number; refs: Set<string> }>;
  rowsSkippedCategory: number;
} {
  const requireDefectCategory = options.requireDefectCategory !== false;
  const remediatedStatuses = options.remediatedStatuses ?? ['已消除', '已闭环'];

  const facts: DefectFactLine[] = [];
  const unmatchedNameMap = new Map<string, { count: number; refs: Set<string> }>();
  let rowsWithDiscoveryCredit = 0;
  let rowsWithRemediationCredit = 0;
  let rowsSkippedCategory = 0;

  for (const row of rows) {
    if (!isDefectCategory(row, requireDefectCategory)) {
      rowsSkippedCategory += 1;
      continue;
    }

    const level = normalizeLevel(row.等级);
    const defectRef = String(row.编号 ?? '').trim();
    if (!level || !defectRef) continue;

    const discoveryYear = parseYear(row.发现时间);
    const remediationYear = parseYear(remediationTime(row));
    const discoverers = parsePersonList(row.发现人);
    const handlers = parsePersonList(row.消缺人);
    const discoverRaw = row.发现人 != null ? String(row.发现人) : '';
    const handlerRaw = row.消缺人 != null ? String(row.消缺人) : '';

    const provisional: ProvisionalDefectLine[] = [];

    if (discoveryYear === year && discoverers.length > 0) {
      rowsWithDiscoveryCredit += 1;
      for (const line of roleLines(discoverers, level, 'discover', scoreMatrix)) {
        provisional.push({
          ...line,
          eventType: 'DISCOVERY',
          eventDate: row.发现时间 != null ? String(row.发现时间) : null,
          rawPersonField: discoverRaw,
        });
      }
    }

    if (
      remediationYear === year &&
      handlers.length > 0 &&
      isRemediated(row.问题状态, remediatedStatuses)
    ) {
      rowsWithRemediationCredit += 1;
      for (const line of roleLines(handlers, level, 'handle', scoreMatrix)) {
        provisional.push({
          ...line,
          eventType: 'REMEDIATION',
          eventDate: remediationTime(row) != null ? String(remediationTime(row)) : null,
          rawPersonField: handlerRaw,
        });
      }
    }

    const deduped = dedupeSamePersonOnDefect(provisional);
    for (const line of deduped) {
      const resolved = resolveName.resolve(line.name);
      if (!resolved) {
        const bucket = unmatchedNameMap.get(line.name) ?? { count: 0, refs: new Set<string>() };
        bucket.count += 1;
        bucket.refs.add(defectRef);
        unmatchedNameMap.set(line.name, bucket);
        continue;
      }

      facts.push({
        dimensionCode: DIMENSION_CODE,
        dimensionTitle: DIMENSION_TITLE,
        year,
        employeeNo: resolved.employeeNo,
        employeeName: resolved.employeeName,
        role: line.role,
        score: line.score,
        defectRef,
        defectLevel: level,
        eventType: line.eventType,
        eventDate: line.eventDate,
        metadata: {
          substation: row.变电站 != null ? String(row.变电站) : null,
          description: row.问题描述 != null ? String(row.问题描述) : null,
          responsibleUnit: row.责任单位 != null ? String(row.责任单位) : null,
          status: row.问题状态 != null ? String(row.问题状态) : null,
          isCollaborative: line.isCollaborative,
          rawPersonField: line.rawPersonField || null,
          personIndex: line.personIndex,
          category: row.所属类别 != null ? String(row.所属类别) : null,
        },
      });
    }
  }

  const byEmployeeMap = new Map<string, EmployeeDimensionAggregate>();
  for (const fact of facts) {
    const key = fact.employeeNo;
    const agg =
      byEmployeeMap.get(key) ??
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
      } satisfies EmployeeDimensionAggregate);
    agg.rawScore += fact.score;
    agg.factCount += 1;
    agg.facts.push(fact);
    byEmployeeMap.set(key, agg);
  }

  const byEmployee = [...byEmployeeMap.values()]
    .map((agg) => ({
      ...agg,
      rawScore: round2(agg.rawScore),
      cappedScore: round2(Math.min(agg.rawScore, DIMENSION_CAP)),
      facts: agg.facts.sort((a, b) => a.defectRef.localeCompare(b.defectRef)),
    }))
    .sort((a, b) => b.cappedScore - a.cappedScore || a.employeeNo.localeCompare(b.employeeNo));

  return {
    year,
    totalDefectRows: rows.length,
    rowsWithDiscoveryCredit,
    rowsWithRemediationCredit,
    facts,
    byEmployee,
    unmatchedNameMap,
    rowsSkippedCategory,
  };
}

export function importDefectGovernanceFacts(
  rows: DefectRow[],
  year: number,
  resolveName: NameResolver,
  options: DefectImportOptions = {},
  scoreMatrix: DefectScoreMatrix = DEFAULT_DEFECT_SCORE_MATRIX,
): DefectImportResult {
  const partial = buildFactsFromDefectRows(rows, year, resolveName, options, scoreMatrix);
  const unmatchedNames = [...partial.unmatchedNameMap.entries()]
    .map(([name, v]) => ({
      name,
      occurrences: v.count,
      sampleDefectRefs: [...v.refs].slice(0, 5),
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  const categoryNote = options.requireDefectCategory !== false
    ? `仅导入所属类别=「缺陷」的记录（跳过 ${partial.rowsSkippedCategory} 条）。`
    : '';

  return {
    dimension: DEFECT_LIBRARY_DIMENSION,
    year,
    filterNote:
      `评价年度 ${year}：发现类按「发现时间」年份；处理类按「消除/消缺时间」年份且状态为已消除/已闭环。` +
      categoryNote +
      `发现 ${partial.rowsWithDiscoveryCredit} 条、处理 ${partial.rowsWithRemediationCredit} 条计入 ${year} 年。` +
      `人员字段含多人时用逗号/顿号分拆，共同发现/处理限 1 人并标记 isCollaborative。`,
    totalDefectRows: partial.totalDefectRows,
    rowsWithDiscoveryCredit: partial.rowsWithDiscoveryCredit,
    rowsWithRemediationCredit: partial.rowsWithRemediationCredit,
    facts: partial.facts,
    byEmployee: partial.byEmployee,
    unmatchedNames,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
