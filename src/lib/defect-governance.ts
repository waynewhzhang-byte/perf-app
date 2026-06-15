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
  问题状态?: string | number | null;
  变电站?: string | number | null;
  问题描述?: string | number | null;
  责任单位?: string | number | null;
  [key: string]: string | number | null | undefined;
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

const LEVEL_SCORES: Record<
  DefectLevel,
  { firstDiscoverer: number; coDiscoverer: number; firstHandler: number; coHandler: number; maxCo: number }
> = {
  危急: { firstDiscoverer: 3, coDiscoverer: 1, firstHandler: 3, coHandler: 1, maxCo: 1 },
  严重: { firstDiscoverer: 1, coDiscoverer: 0.5, firstHandler: 1, coHandler: 0.5, maxCo: 1 },
  一般: { firstDiscoverer: 0.5, coDiscoverer: 0, firstHandler: 0.5, coHandler: 0, maxCo: 0 },
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
): { role: DefectFactRole; name: string; score: number }[] {
  if (people.length === 0) return [];
  const rule = LEVEL_SCORES[level];
  const [first, ...rest] = people;
  const lines: { role: DefectFactRole; name: string; score: number }[] = [];

  if (kind === 'discover') {
    lines.push({ role: 'FIRST_DISCOVERER', name: first, score: rule.firstDiscoverer });
    if (rule.maxCo > 0 && rest[0]) {
      lines.push({ role: 'CO_DISCOVERER', name: rest[0], score: rule.coDiscoverer });
    }
  } else {
    lines.push({ role: 'FIRST_HANDLER', name: first, score: rule.firstHandler });
    if (rule.maxCo > 0 && rest[0]) {
      lines.push({ role: 'CO_HANDLER', name: rest[0], score: rule.coHandler });
    }
  }
  return lines;
}

/** 同一缺陷、同一人兼发现与处理：只保留较高分的一条事实 */
function dedupeSamePersonOnDefect(
  lines: { role: DefectFactRole; name: string; score: number; eventType: 'DISCOVERY' | 'REMEDIATION' }[],
): typeof lines {
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
): Omit<DefectImportResult, 'dimension' | 'filterNote' | 'unmatchedNames'> & {
  unmatchedNameMap: Map<string, { count: number; refs: Set<string> }>;
} {
  const facts: DefectFactLine[] = [];
  const unmatchedNameMap = new Map<string, { count: number; refs: Set<string> }>();
  let rowsWithDiscoveryCredit = 0;
  let rowsWithRemediationCredit = 0;

  for (const row of rows) {
    const level = normalizeLevel(row.等级);
    const defectRef = String(row.编号 ?? '').trim();
    if (!level || !defectRef) continue;

    const discoveryYear = parseYear(row.发现时间);
    const remediationYear = parseYear(row.消缺时间);
    const discoverers = parsePersonList(row.发现人);
    const handlers = parsePersonList(row.消缺人);

    const provisional: {
      role: DefectFactRole;
      name: string;
      score: number;
      eventType: 'DISCOVERY' | 'REMEDIATION';
      eventDate: string | null;
    }[] = [];

    if (discoveryYear === year && discoverers.length > 0) {
      rowsWithDiscoveryCredit += 1;
      for (const line of roleLines(discoverers, level, 'discover')) {
        provisional.push({
          ...line,
          eventType: 'DISCOVERY',
          eventDate: row.发现时间 != null ? String(row.发现时间) : null,
        });
      }
    }

    if (remediationYear === year && handlers.length > 0) {
      rowsWithRemediationCredit += 1;
      for (const line of roleLines(handlers, level, 'handle')) {
        provisional.push({
          ...line,
          eventType: 'REMEDIATION',
          eventDate: row.消缺时间 != null ? String(row.消缺时间) : null,
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
        eventDate: null,
        metadata: {
          substation: row.变电站 != null ? String(row.变电站) : null,
          description: row.问题描述 != null ? String(row.问题描述) : null,
          responsibleUnit: row.责任单位 != null ? String(row.责任单位) : null,
          status: row.问题状态 != null ? String(row.问题状态) : null,
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
  };
}

export function importDefectGovernanceFacts(
  rows: DefectRow[],
  year: number,
  resolveName: NameResolver,
): DefectImportResult {
  const partial = buildFactsFromDefectRows(rows, year, resolveName);
  const unmatchedNames = [...partial.unmatchedNameMap.entries()]
    .map(([name, v]) => ({
      name,
      occurrences: v.count,
      sampleDefectRefs: [...v.refs].slice(0, 5),
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    dimension: DEFECT_LIBRARY_DIMENSION,
    year,
    filterNote:
      `评价年度 ${year}：发现类事实按「发现时间」年份过滤；处理类事实按「消缺时间」年份过滤。` +
      `本表为 2024 年消缺名单，处理类事实覆盖全部 ${partial.totalDefectRows} 条；` +
      `发现类事实仅 ${partial.rowsWithDiscoveryCredit} 条发现时间在 ${year} 年。`,
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
