/**
 * 两票导入 API 共用：名册解析 + 明细聚合
 */
import type { PrismaClient } from '@prisma/client';
import { loadTicketPrices } from '@/lib/import-pipeline';
import { createRosterResolverFromUsers } from '@/lib/roster-resolver';
import {
  aggregateTicketExecutionRows,
  DEFAULT_TICKET_PRICES,
  type TicketExecutionParseResult,
} from '@/lib/ticket-execution-import';

export const TICKET_SHEET_NAMES = ['操作票', '工作票'] as const;

export interface TicketImportPayload {
  year: number;
  sourceFile: string;
  operationRows: Record<string, string>[];
  workRows: Record<string, string>[];
  unitFilter?: string;
}

export async function aggregateTicketsForImport(
  prisma: PrismaClient,
  payload: TicketImportPayload,
): Promise<TicketExecutionParseResult> {
  const users = await prisma.user.findMany({
    where: { employeeNo: { not: null } },
    select: { employeeNo: true, fullName: true },
  });
  const rosterUsers = users
    .filter((u): u is { employeeNo: string; fullName: string } => Boolean(u.employeeNo))
    .map((u) => ({ employeeNo: u.employeeNo, fullName: u.fullName }));

  if (rosterUsers.length === 0) {
    throw new Error('请先导入员工档案名册（无可用工号）');
  }

  const resolver = createRosterResolverFromUsers(rosterUsers);
  const prices = await loadTicketPrices(prisma).catch(() => DEFAULT_TICKET_PRICES);

  return aggregateTicketExecutionRows(
    payload.operationRows,
    payload.workRows,
    resolver,
    { unitFilter: payload.unitFilter },
    prices,
  );
}
