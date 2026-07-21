/**
 * 事实数据持久化的薄适配层。
 *
 * 真正的批量写入 seam 在 src/lib/performance-fact-repository.ts（事务 + createMany 分块）。
 * 本文件只保留两类东西：
 *   - 维度专属适配器：把业务对象（TicketExecutionAggregate 等）转换成 PerformanceFactSeed
 *   - Excel 读取工具（与 XLSX 库耦合，不属于 repository 的职责）
 */
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import type { PrismaClient, PerformanceFactRole } from '@prisma/client';
import type { TicketExecutionAggregate } from '@/lib/ticket-execution-import';
import { TICKET_EXECUTION_DIMENSION } from '@/lib/performance-dimension-registry';
import {
  replaceFactsBySource,
  type PerformanceFactSeed,
  type ReplaceFactsResult,
} from '@/lib/performance-fact-repository';

export type { PerformanceFactSeed, ReplaceFactsResult };
export { replaceFactsBySource } from '@/lib/performance-fact-repository';

/**
 * 按 employeeNo 批量查 userId，返回 Map 供 batch-replace 写入。
 * 不放入 performance-fact-repository.ts 是因为它依赖 User 表（不同模型），
 * 而事实 repository 的职责仅限于 PerformanceFact。
 */
export async function loadUserIdByEmployeeNo(
  prisma: PrismaClient,
  employeeNos: string[],
): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { employeeNo: { in: employeeNos } },
    select: { id: true, employeeNo: true },
  });
  return new Map(
    users.filter((u) => u.employeeNo).map((u) => [u.employeeNo!, u.id]),
  );
}

/**
 * 两票：每人一条汇总事实，score = 原始分（折算在申报层完成）。
 *
 * 历史上此函数自己实现 deleteMany + upsert 循环；现在转为构造 PerformanceFactSeed[]
 * 后委托给 replaceFactsBySource。defectRef 用 `ticket-aggregate-{employeeNo}` 占位
 * （两票在事实层是一人一条，没有缺陷编号概念）。
 */
export async function persistTicketAggregates(
  prisma: Parameters<typeof replaceFactsBySource>[0],
  year: number,
  sourceFile: string,
  aggregates: TicketExecutionAggregate[],
  userIdByNo: Map<string, string>,
): Promise<ReplaceFactsResult> {
  const dimensionCode = TICKET_EXECUTION_DIMENSION.code;
  const seeds: PerformanceFactSeed[] = aggregates.map((agg) => ({
    year,
    employeeNo: agg.employeeNo,
    employeeName: agg.employeeName,
    dimensionCode,
    dimensionTitle: TICKET_EXECUTION_DIMENSION.title,
    role: 'FIRST_HANDLER' satisfies PerformanceFactRole,
    eventType: 'REMEDIATION',
    score: agg.rawScore,
    defectRef: `ticket-aggregate-${agg.employeeNo}`,
    defectLevel: '',
    eventDate: null,
    metadata: {
      rawScore: agg.rawScore,
      isRawScore: true,
      breakdown: agg.breakdown,
    },
  }));

  return replaceFactsBySource(
    prisma,
    { year, dimensionCode, sourceFile },
    seeds,
    userIdByNo,
  );
}

export function readXlsxSheetRows(
  filePath: string,
  sheetName: string,
): Record<string, string | number | null>[] {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`缺少工作表「${sheetName}」`);
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<
    string,
    string | number | null
  >[];
}
