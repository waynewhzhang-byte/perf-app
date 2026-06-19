/**
 * 从《工作现场-两票执行》原始明细（操作票 + 工作票）聚合每人原始分。
 * 原始分在申报时按能级内最高分比例折算为满分 30（见 ticket-execution.ts）。
 */
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { normalizePersonName } from '@/lib/employee-resolver';
import { parsePersonList } from '@/lib/defect-governance';
import { TICKET_EXECUTION_DIMENSION } from '@/lib/evaluation-dimensions';

export interface TicketScoreBreakdown {
  operationSteps: number;
  operationPoints: number;
  workLeaderPoints: number;
  workPermitterPoints: number;
  workMemberPoints: number;
  operationTicketCount: number;
  workTicketCount: number;
}

export interface TicketExecutionAggregate {
  employeeNo: string;
  employeeName: string;
  rawScore: number;
  breakdown: TicketScoreBreakdown;
}

export interface TicketExecutionImportOptions {
  /** 仅统计指定单位（空=全部） */
  unitFilter?: string;
  /** 操作票有效状态 */
  operationArchivedOnly?: boolean;
}

/** 两票单价表（来自 ScoringRule.config；DB 无配置时回退 DEFAULT_*） */
export interface TicketPriceConfig {
  /** 操作票：每操作步单价 */
  operationStepPrice: number;
  /** 工作票：角色 × 票种类 → 每份得分 */
  workLeader: Record<string, number>;
  workPermitter: Record<string, number>;
  workMember: Record<string, number>;
}

/** 默认单价表（与《2025量化积分表》一致；与 defaultScoringRuleConfigs 的 ticket 配置同源） */
export const DEFAULT_TICKET_PRICES: TicketPriceConfig = {
  operationStepPrice: 0.01,
  workLeader: { 总工作票: 5, 分工作票: 3, 单班组一种票: 3, 二种票: 1 },
  workPermitter: { 总工作票: 1.5, 单班组一种票: 1, 二种票: 0.3 },
  workMember: { 单班组一种票: 1.5, 二种票: 0.5 },
};

const OP_ROLE_COLUMNS = ['操作人', '监护人', '值班负责人', '现场配合人员'] as const;

/** 工作角色 → 对应单价表键 */
export type WorkRole = 'workLeader' | 'workPermitter' | 'workMember';

/** 查某工作角色在某票种类下的每份得分；未配置返回 0 */
export function resolveWorkTicketPrice(
  role: WorkRole,
  ticketType: string,
  prices: TicketPriceConfig = DEFAULT_TICKET_PRICES,
): number {
  const table = prices[role] ?? {};
  return Object.prototype.hasOwnProperty.call(table, ticketType) ? table[ticketType] : 0;
}

function cellString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function cellNumber(value: unknown): number {
  const s = cellString(value);
  if (!s || s === '/' || s === '#DIV/0!') return 0;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function sheetMatrix(wb: XLSX.WorkBook, name: string): Record<string, string>[] {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<string, string>[];
}

function emptyBreakdown(): TicketScoreBreakdown {
  return {
    operationSteps: 0,
    operationPoints: 0,
    workLeaderPoints: 0,
    workPermitterPoints: 0,
    workMemberPoints: 0,
    operationTicketCount: 0,
    workTicketCount: 0,
  };
}

type AggBucket = TicketExecutionAggregate & { nameKeys: Set<string> };

function getBucket(
  map: Map<string, AggBucket>,
  employeeNo: string,
  employeeName: string,
): AggBucket {
  let b = map.get(employeeNo);
  if (!b) {
    b = {
      employeeNo,
      employeeName,
      rawScore: 0,
      breakdown: emptyBreakdown(),
      nameKeys: new Set(),
    };
    map.set(employeeNo, b);
  }
  b.nameKeys.add(normalizePersonName(employeeName));
  if (employeeName.length > b.employeeName.length) b.employeeName = employeeName;
  return b;
}

function addPoints(bucket: AggBucket, field: keyof TicketScoreBreakdown, points: number) {
  bucket.breakdown[field] = round2(bucket.breakdown[field] + points);
  bucket.rawScore = round2(bucket.rawScore + points);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface TicketExecutionParseResult {
  sourceFile: string;
  aggregates: TicketExecutionAggregate[];
  byEmployeeNo: Map<string, TicketExecutionAggregate>;
  byName: Map<string, TicketExecutionAggregate>;
  unmatchedNames: string[];
  stats: {
    operationRows: number;
    workRows: number;
    employeeCount: number;
  };
}

export interface EmployeeNoResolver {
  resolve(name: string): { employeeNo: string; employeeName: string } | null;
}

/** 解析并聚合两票原始分（需先有员工工号名册） */
export function aggregateTicketExecutionFromFile(
  filePath: string,
  resolveNo: EmployeeNoResolver,
  options: TicketExecutionImportOptions = {},
  priceConfig: TicketPriceConfig = DEFAULT_TICKET_PRICES,
): TicketExecutionParseResult {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const unitFilter = options.unitFilter?.trim();
  const archivedOnly = options.operationArchivedOnly !== false;

  const map = new Map<string, AggBucket>();
  const unmatched = new Set<string>();

  const opRows = sheetMatrix(wb, '操作票');
  for (const row of opRows) {
    if (unitFilter && cellString(row['单位']) !== unitFilter) continue;
    if (archivedOnly && cellString(row['票状态']) !== '已归档') continue;

    const steps = cellNumber(row['实际操作步数']);
    if (steps <= 0) continue;
    const points = round2(steps * priceConfig.operationStepPrice);

    const touched = new Set<string>();
    for (const col of OP_ROLE_COLUMNS) {
      for (const name of parsePersonList(row[col])) {
        const hit = resolveNo.resolve(name);
        if (!hit) {
          unmatched.add(name);
          continue;
        }
        const bucket = getBucket(map, hit.employeeNo, hit.employeeName);
        addPoints(bucket, 'operationPoints', points);
        if (!touched.has(hit.employeeNo)) {
          bucket.breakdown.operationSteps += steps;
          bucket.breakdown.operationTicketCount += 1;
          touched.add(hit.employeeNo);
        }
      }
    }
  }

  const workRows = sheetMatrix(wb, '工作票');
  for (const row of workRows) {
    if (unitFilter && cellString(row['单位']) !== unitFilter) continue;

    const ticketType = cellString(row['票种类']);
    const leaderScore = resolveWorkTicketPrice('workLeader', ticketType, priceConfig);
    const permitScore = resolveWorkTicketPrice('workPermitter', ticketType, priceConfig);
    const memberScore = resolveWorkTicketPrice('workMember', ticketType, priceConfig);

    if (leaderScore > 0 && cellString(row['工作负责人'])) {
      for (const name of parsePersonList(row['工作负责人'])) {
        const hit = resolveNo.resolve(name);
        if (!hit) {
          unmatched.add(name);
          continue;
        }
        const bucket = getBucket(map, hit.employeeNo, hit.employeeName);
        addPoints(bucket, 'workLeaderPoints', leaderScore);
      }
    }

    for (const col of ['开工许可人', '完工许可人'] as const) {
      if (permitScore <= 0 || !cellString(row[col])) continue;
      for (const name of parsePersonList(row[col])) {
        const hit = resolveNo.resolve(name);
        if (!hit) {
          unmatched.add(name);
          continue;
        }
        const bucket = getBucket(map, hit.employeeNo, hit.employeeName);
        addPoints(bucket, 'workPermitterPoints', permitScore);
      }
    }

    // 专责监护 → 工作班成员（一种/二种票）
    if (memberScore > 0 && cellString(row['专责监护'])) {
      for (const name of parsePersonList(row['专责监护'])) {
        const hit = resolveNo.resolve(name);
        if (!hit) {
          unmatched.add(name);
          continue;
        }
        const bucket = getBucket(map, hit.employeeNo, hit.employeeName);
        addPoints(bucket, 'workMemberPoints', memberScore);
      }
    }

    if (leaderScore > 0 || permitScore > 0 || memberScore > 0) {
      const creditedNos = new Set<string>();
      const namesOnTicket = [
        ...parsePersonList(row['工作负责人']),
        ...parsePersonList(row['开工许可人']),
        ...parsePersonList(row['完工许可人']),
        ...parsePersonList(row['专责监护']),
      ];
      for (const name of namesOnTicket) {
        const hit = resolveNo.resolve(name);
        if (hit) creditedNos.add(hit.employeeNo);
      }
      for (const no of creditedNos) {
        const bucket = map.get(no);
        if (bucket) bucket.breakdown.workTicketCount += 1;
      }
    }
  }

  const aggregates = [...map.values()]
    .map(({ nameKeys: _, ...rest }) => rest)
    .sort((a, b) => b.rawScore - a.rawScore || a.employeeNo.localeCompare(b.employeeNo));

  const byEmployeeNo = new Map(aggregates.map((a) => [a.employeeNo, a]));
  const byName = new Map<string, TicketExecutionAggregate>();
  for (const agg of aggregates) {
    byName.set(normalizePersonName(agg.employeeName), agg);
  }

  return {
    sourceFile: filePath,
    aggregates,
    byEmployeeNo,
    byName,
    unmatchedNames: [...unmatched].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    stats: {
      operationRows: opRows.length,
      workRows: workRows.length,
      employeeCount: aggregates.length,
    },
  };
}

export const TICKET_DIMENSION = TICKET_EXECUTION_DIMENSION;
