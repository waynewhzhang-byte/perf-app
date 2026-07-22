/**
 * 从《工作现场-两票执行》原始明细（操作票 + 工作票）聚合每人原始分。
 * 原始分在申报时按能级内最高分比例折算为满分 30。
 */
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { normalizePersonName } from '@/lib/employee-resolver';
import { parsePersonList } from '@/lib/defect-governance';
import { TICKET_EXECUTION_DIMENSION } from '@/lib/performance-dimension-registry';

export interface TicketScoreBreakdown {
  /** 操作票角色项数（每行每角色每人计 1 项） */
  operationItems: number;
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
  /** 操作票：每项（一行一次角色参与）单价，与操作步数无关 */
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
const OP_ROLE_EMPLOYEE_NO_COLUMNS: Record<(typeof OP_ROLE_COLUMNS)[number], string> = {
  操作人: '人员编号',
  监护人: '人员编号_1',
  值班负责人: '人员编号_2',
  现场配合人员: '人员编号_3',
};

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

function sheetMatrix(wb: XLSX.WorkBook, name: string): Record<string, string>[] {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return rowsToMatrix(XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }));
}

/** 将 sheet_to_json 结果规范为 string 单元格（浏览器上传/API 共用） */
export function rowsToMatrix(raw: Record<string, unknown>[]): Record<string, string>[] {
  return raw.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!k || k.startsWith('__EMPTY')) continue;
      out[k] = cellString(v);
    }
    return out;
  });
}

/** 操作票可计分状态（票状态仅表示记录状态，与作业内容无关；已执行亦计入） */
export function isOperationTicketEligible(status: string): boolean {
  const s = status.trim();
  return s === '已归档' || s === '归档' || s === '已执行';
}

/** @deprecated 使用 isOperationTicketEligible */
export const isOperationTicketArchived = isOperationTicketEligible;

function emptyBreakdown(): TicketScoreBreakdown {
  return {
    operationItems: 0,
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
  resolve(name: string, employeeNo?: string): { employeeNo: string; employeeName: string } | null;
}

/** 从操作票 + 工作票明细行聚合每人原始分（需先有员工工号名册） */
export function aggregateTicketExecutionRows(
  opRows: Record<string, string>[],
  workRows: Record<string, string>[],
  resolveNo: EmployeeNoResolver,
  options: TicketExecutionImportOptions = {},
  priceConfig: TicketPriceConfig = DEFAULT_TICKET_PRICES,
): TicketExecutionParseResult {
  const unitFilter = options.unitFilter?.trim();
  const archivedOnly = options.operationArchivedOnly !== false;

  const map = new Map<string, AggBucket>();
  const unmatched = new Set<string>();

  const itemPrice = priceConfig.operationStepPrice;

  for (const row of opRows) {
    if (unitFilter && cellString(row['单位']) !== unitFilter) continue;
    if (archivedOnly && !isOperationTicketEligible(cellString(row['票状态']))) continue;

    // 规则（评分标准 对应表.xlsx 行 38）：
    //   操作票中同一票号「操作人、监护人、值班负责人、现场配合人员」四列按人计数，
    //   且每条数据中每人只计一次分。
    // `touched` 同时承担两件事：① 保证同一员工在同一行只加一次分；② 统计唯一参与票数。
    const touched = new Set<string>();
    for (const col of OP_ROLE_COLUMNS) {
      for (const name of parsePersonList(row[col])) {
        const hit = resolveNo.resolve(name, cellString(row[OP_ROLE_EMPLOYEE_NO_COLUMNS[col]]));
        if (!hit) {
          unmatched.add(name);
          continue;
        }
        const bucket = getBucket(map, hit.employeeNo, hit.employeeName);
        if (!touched.has(hit.employeeNo)) {
          addPoints(bucket, 'operationPoints', itemPrice);
          bucket.breakdown.operationItems += 1;
          bucket.breakdown.operationTicketCount += 1;
          touched.add(hit.employeeNo);
        }
      }
    }
  }

  for (const row of workRows) {
    if (unitFilter && cellString(row['单位']) !== unitFilter) continue;

    const ticketType = cellString(row['票种类']);
    const leaderScore = resolveWorkTicketPrice('workLeader', ticketType, priceConfig);
    const permitScore = resolveWorkTicketPrice('workPermitter', ticketType, priceConfig);

    if (leaderScore > 0 && cellString(row['工作负责人'])) {
      for (const name of parsePersonList(row['工作负责人'])) {
        const hit = resolveNo.resolve(name, cellString(row['人员编号']));
        if (!hit) {
          unmatched.add(name);
          continue;
        }
        const bucket = getBucket(map, hit.employeeNo, hit.employeeName);
        addPoints(bucket, 'workLeaderPoints', leaderScore);
      }
    }

    // 开工、完工许可人为同一人时整张票计一次；不是同一人时按评分表均分。
    const permitters = new Map<string, { employeeNo: string; employeeName: string }>();
    for (const col of ['开工许可人', '完工许可人'] as const) {
      if (permitScore <= 0 || !cellString(row[col])) continue;
      const employeeNoColumn = col === '开工许可人' ? '人员编号_1' : '人员编号_2';
      for (const name of parsePersonList(row[col])) {
        const hit = resolveNo.resolve(name, cellString(row[employeeNoColumn]));
        if (!hit) {
          unmatched.add(name);
          continue;
        }
        permitters.set(hit.employeeNo, hit);
      }
    }
    const permitterScore = permitters.size ? permitScore / permitters.size : 0;
    for (const hit of permitters.values()) {
      const bucket = getBucket(map, hit.employeeNo, hit.employeeName);
      addPoints(bucket, 'workPermitterPoints', permitterScore);
    }

    if (leaderScore > 0 || permitScore > 0) {
      const creditedNos = new Set<string>();
      const namesOnTicket = [
        ...parsePersonList(row['工作负责人']),
        ...parsePersonList(row['开工许可人']),
        ...parsePersonList(row['完工许可人']),
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
    sourceFile: '',
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

/** 解析并聚合两票原始分（需先有员工工号名册） */
export function aggregateTicketExecutionFromFile(
  filePath: string,
  resolveNo: EmployeeNoResolver,
  options: TicketExecutionImportOptions = {},
  priceConfig: TicketPriceConfig = DEFAULT_TICKET_PRICES,
): TicketExecutionParseResult {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const opRows = sheetMatrix(wb, '操作票');
  const workRows = sheetMatrix(wb, '工作票');
  const result = aggregateTicketExecutionRows(opRows, workRows, resolveNo, options, priceConfig);
  return { ...result, sourceFile: filePath };
}

// ── Work Member Ticket Aggregation (files 12/13) ────────────────

export interface WorkMemberRow {
  票类型: string;
  姓名: string;
  人员编号: string | number;
}

export interface WorkMemberAggregate {
  employeeNo: string;
  employeeName: string;
  type1Count: number;  // 一种票 count
  type2Count: number;  // 二种票 count
}

/** Group rows from 二种票 (file 12) and 一种票 (file 13) by employeeNo and count ticket types. */
export function aggregateWorkMemberTickets(rows: WorkMemberRow[]): WorkMemberAggregate[] {
  const map = new Map<string, WorkMemberAggregate>();

  for (const row of rows) {
    const no = String(row.人员编号 ?? '').trim();
    const name = (row.姓名 ?? '').trim();
    if (!no) continue;

    const key = no;
    if (!map.has(key)) {
      map.set(key, { employeeNo: no, employeeName: name, type1Count: 0, type2Count: 0 });
    }

    const agg = map.get(key)!;
    if (row.票类型?.includes('一种')) {
      agg.type1Count += 1;
    } else if (row.票类型?.includes('二种')) {
      agg.type2Count += 1;
    }
  }

  return [...map.values()];
}

/**
 * 把工作班成员的一种票/二种票得分合并进两票汇总。
 *
 * 原始工作票明细不包含工作班成员，必须与文件 12、13 一起计算；否则会漏掉
 * 评分表第 49、50 行的 1.5 / 0.5 分。
 */
export function mergeWorkMemberTicketScores(
  aggregates: TicketExecutionAggregate[],
  memberRows: WorkMemberRow[],
  prices: TicketPriceConfig = DEFAULT_TICKET_PRICES,
): TicketExecutionAggregate[] {
  const byNo = new Map(
    aggregates.map((aggregate) => [
      aggregate.employeeNo,
      {
        ...aggregate,
        breakdown: { ...aggregate.breakdown },
      },
    ]),
  );

  for (const member of aggregateWorkMemberTickets(memberRows)) {
    const memberPoints =
      member.type1Count * resolveWorkTicketPrice('workMember', '单班组一种票', prices)
      + member.type2Count * resolveWorkTicketPrice('workMember', '二种票', prices);
    if (memberPoints === 0) continue;

    const aggregate = byNo.get(member.employeeNo) ?? {
      employeeNo: member.employeeNo,
      employeeName: member.employeeName,
      rawScore: 0,
      breakdown: emptyBreakdown(),
    };
    aggregate.rawScore = round2(aggregate.rawScore + memberPoints);
    aggregate.breakdown.workMemberPoints = round2(
      aggregate.breakdown.workMemberPoints + memberPoints,
    );
    byNo.set(member.employeeNo, aggregate);
  }

  return [...byNo.values()].sort(
    (a, b) => b.rawScore - a.rawScore || a.employeeNo.localeCompare(b.employeeNo),
  );
}

export const TICKET_DIMENSION = TICKET_EXECUTION_DIMENSION;
