/**
 * 事实数据持久化的薄适配层。
 *
 * 真正的批量写入 seam 在 src/lib/performance-fact-repository.ts（事务 + createMany 分块）。
 * 本文件只保留两类东西：
 *   - 维度专属适配器：把业务对象（TicketExecutionRecord 等）转换成 PerformanceFactSeed
 *   - Excel 读取工具（与 XLSX 库耦合，不属于 repository 的职责）
 */
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import type { PrismaClient, PerformanceFactRole } from '@prisma/client';
import type { TicketExecutionRecord } from '@/lib/ticket-execution-import';
import { TICKET_EXECUTION_DIMENSION } from '@/lib/scoring-standards';
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
 * 两票：每次员工参与一张票形成一条事实，score = 本次参与原始分。
 * 员工原始总分由这些事实求和，专业折算仍在申报层完成。
 */
export async function persistTicketRecords(
  prisma: Parameters<typeof replaceFactsBySource>[0],
  year: number,
  sourceFile: string,
  records: TicketExecutionRecord[],
  userIdByNo: Map<string, string>,
  options: {
    replaceAcrossSourceFiles?: boolean;
    refreshSubmissions?: boolean;
    preserveEmployeeScoreTotals?: boolean;
    createdBy?: string;
  } = {},
): Promise<ReplaceFactsResult> {
  const dimensionCode = TICKET_EXECUTION_DIMENSION.code;
  const seeds: PerformanceFactSeed[] = records.map((record) => ({
    year,
    employeeNo: record.employeeNo,
    employeeName: record.employeeName,
    dimensionCode,
    dimensionTitle: TICKET_EXECUTION_DIMENSION.title,
    role: 'FIRST_HANDLER' satisfies PerformanceFactRole,
    eventType: 'REMEDIATION',
    score: record.score,
    defectRef: record.recordKey,
    defectLevel: '',
    eventDate: record.eventDate,
    sourceFile: record.sourceFile,
    recordKey: record.recordKey,
    recordType: record.recordType,
    recordTitle: record.recordTitle,
    participationRole: record.participationRole,
    sourceSheet: record.sourceSheet,
    sourceRowNo: record.sourceRowNo,
    metadata: {
      isRawScore: true,
      scoreCategory: record.scoreCategory,
      sourceData: record.sourceData,
    },
  }));

  return replaceFactsBySource(
    prisma,
    { year, dimensionCode, sourceFile, ...options },
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
