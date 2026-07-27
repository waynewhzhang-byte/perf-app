import {
  DEFECT_LIBRARY_DIMENSION,
  type EvaluationDimensionCode,
} from '@/lib/scoring-standards';
import {
  computeFactScores,
  type FactInput,
  type ScoringRule,
} from '@/lib/scoring-engine';
import { round2 } from '@/lib/rounding';

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

const DIMENSION_CODE = DEFECT_LIBRARY_DIMENSION.code;
const DIMENSION_TITLE = DEFECT_LIBRARY_DIMENSION.title;
const DIMENSION_CAP = DEFECT_LIBRARY_DIMENSION.maxScore;

/**
 * 测试用默认矩阵（与 defaultScoringRuleConfigs 的 defect 配置一致）。
 * 生产 / scripts 一律从 DB `ScoringRule` 传入；勿在运行时当回退源。
 */
export const DEFAULT_DEFECT_SCORE_MATRIX: Record<
  DefectLevel,
  Partial<Record<DefectFactRole, number>>
> = {
  危急: { FIRST_DISCOVERER: 3, CO_DISCOVERER: 1, FIRST_HANDLER: 3, CO_HANDLER: 1 },
  严重: { FIRST_DISCOVERER: 1, CO_DISCOVERER: 0.5, FIRST_HANDLER: 1, CO_HANDLER: 0.5 },
  一般: { FIRST_DISCOVERER: 0.5, FIRST_HANDLER: 0.5 },
};

/** 测试用 ScoringRule fixture（生产请 load DB） */
export function defectScoringRuleFixture(
  overrides: Partial<ScoringRule> = {},
): ScoringRule {
  return {
    id: 'fixture-defect',
    dimensionCode: DIMENSION_CODE,
    ruleType: 'MATRIX',
    cap: DIMENSION_CAP,
    enabled: true,
    matrix: DEFAULT_DEFECT_SCORE_MATRIX as Record<string, Record<string, number>>,
    tieBreak: 'MAX_PER_PERSON',
    ...overrides,
  };
}

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

/** 角色分拆（不计分；共同人是否得分由引擎按矩阵决定） */
function roleLines(
  people: string[],
  kind: 'discover' | 'handle',
): { role: DefectFactRole; name: string; personIndex: number; isCollaborative: boolean }[] {
  if (people.length === 0) return [];
  const [first, ...rest] = people;
  const lines: ReturnType<typeof roleLines> = [];

  if (kind === 'discover') {
    lines.push({
      role: 'FIRST_DISCOVERER',
      name: first,
      personIndex: 0,
      isCollaborative: false,
    });
    if (rest[0]) {
      lines.push({
        role: 'CO_DISCOVERER',
        name: rest[0],
        personIndex: 1,
        isCollaborative: true,
      });
    }
  } else {
    lines.push({
      role: 'FIRST_HANDLER',
      name: first,
      personIndex: 0,
      isCollaborative: false,
    });
    if (rest[0]) {
      lines.push({
        role: 'CO_HANDLER',
        name: rest[0],
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
  eventType: 'DISCOVERY' | 'REMEDIATION';
  eventDate: string | null;
  personIndex: number;
  isCollaborative: boolean;
  rawPersonField: string;
};

export interface NameResolver {
  resolve(name: string): { employeeNo: string; employeeName: string } | null;
}

/**
 * Excel 问题清单 → 缺陷事实。
 * 解析/姓名分拆在本模块；计分一律走 `computeFactScores`（MATRIX）。
 */
export function buildFactsFromDefectRows(
  rows: DefectRow[],
  year: number,
  resolveName: NameResolver,
  options: DefectImportOptions = {},
  scoringRule: ScoringRule = defectScoringRuleFixture(),
): Omit<DefectImportResult, 'dimension' | 'filterNote' | 'unmatchedNames'> & {
  unmatchedNameMap: Map<string, { count: number; refs: Set<string> }>;
  rowsSkippedCategory: number;
} {
  const requireDefectCategory = options.requireDefectCategory !== false;
  const remediatedStatuses = options.remediatedStatuses ?? ['已消除', '已闭环'];

  const unmatchedNameMap = new Map<string, { count: number; refs: Set<string> }>();
  let rowsWithDiscoveryCredit = 0;
  let rowsWithRemediationCredit = 0;
  let rowsSkippedCategory = 0;

  const inputs: FactInput[] = [];

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
      for (const line of roleLines(discoverers, 'discover')) {
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
      for (const line of roleLines(handlers, 'handle')) {
        provisional.push({
          ...line,
          eventType: 'REMEDIATION',
          eventDate: remediationTime(row) != null ? String(remediationTime(row)) : null,
          rawPersonField: handlerRaw,
        });
      }
    }

    // 同人兼发现/处理：不在此去重，交给 MATRIX 按 emp|defectRef|level 取高分
    for (const line of provisional) {
      const resolved = resolveName.resolve(line.name);
      if (!resolved) {
        const bucket = unmatchedNameMap.get(line.name) ?? { count: 0, refs: new Set<string>() };
        bucket.count += 1;
        bucket.refs.add(defectRef);
        unmatchedNameMap.set(line.name, bucket);
        continue;
      }

      inputs.push({
        employeeNo: resolved.employeeNo,
        employeeName: resolved.employeeName,
        dimensionCode: DIMENSION_CODE,
        role: line.role,
        eventType: line.eventType,
        defectLevel: level,
        defectRef,
        eventDate: line.eventDate ?? undefined,
        sourceFile: 'defect-governance',
        metadata: {
          substation: row.变电站 != null ? String(row.变电站) : null,
          description: row.问题描述 != null ? String(row.问题描述) : null,
          responsibleUnit: row.责任单位 != null ? String(row.责任单位) : null,
          status: row.问题状态 != null ? String(row.问题状态) : null,
          isCollaborative: line.isCollaborative,
          rawPersonField: line.rawPersonField || null,
          personIndex: line.personIndex,
          category: row.所属类别 != null ? String(row.所属类别) : null,
          sourceData: Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)]),
          ),
        },
      });
    }
  }

  const scored = computeFactScores(inputs, [scoringRule]);

  const facts: DefectFactLine[] = scored.map((f) => {
    const meta = (f.metadata ?? {}) as DefectFactLine['metadata'];
    return {
      dimensionCode: DIMENSION_CODE,
      dimensionTitle: DIMENSION_TITLE,
      year,
      employeeNo: f.employeeNo,
      employeeName: f.employeeName,
      role: f.role as DefectFactRole,
      score: f.score,
      defectRef: f.defectRef ?? '',
      defectLevel: (f.defectLevel ?? '') as DefectLevel,
      eventType: f.eventType,
      eventDate: f.eventDate ?? null,
      metadata: {
        substation: meta.substation ?? null,
        description: meta.description ?? null,
        responsibleUnit: meta.responsibleUnit ?? null,
        status: meta.status ?? null,
        isCollaborative: Boolean(meta.isCollaborative),
        rawPersonField: meta.rawPersonField ?? null,
        personIndex: typeof meta.personIndex === 'number' ? meta.personIndex : 0,
        category: meta.category ?? null,
      },
    };
  });

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
  scoringRule: ScoringRule = defectScoringRuleFixture(),
): DefectImportResult {
  const partial = buildFactsFromDefectRows(rows, year, resolveName, options, scoringRule);
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
      `人员字段含多人时用逗号/顿号分拆，共同发现/处理限 1 人并标记 isCollaborative。` +
      `计分经 scoring-engine MATRIX（分组键含 defectRef）。`,
    totalDefectRows: partial.totalDefectRows,
    rowsWithDiscoveryCredit: partial.rowsWithDiscoveryCredit,
    rowsWithRemediationCredit: partial.rowsWithRemediationCredit,
    facts: partial.facts,
    byEmployee: partial.byEmployee,
    unmatchedNames,
  };
}
