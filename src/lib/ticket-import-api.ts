/**
 * 两票导入 API 共用：名册解析 + 明细聚合
 */
import type { PrismaClient } from '@prisma/client';
import { createRosterResolverFromUsers } from '@/lib/roster-resolver';
import { defaultScoringRuleConfigs } from '@/lib/scoring-standards';
import {
  aggregateTicketExecutionRows,
  DEFAULT_TICKET_PRICES,
  type TicketExecutionParseResult,
  type TicketPriceConfig,
} from '@/lib/ticket-execution-import';

export const TICKET_SHEET_NAMES = ['操作票', '工作票'] as const;

export interface TicketImportPayload {
  year: number;
  sourceFile: string;
  operationRows: Record<string, string>[];
  workRows: Record<string, string>[];
  unitFilter?: string;
}

/**
 * 读两票单价表（DB 优先，回退默认种子）。
 *
 * 历史上此函数与 `loadRuleConfig` / `loadDefectScoreMatrix` / `loadSafetyScoreConfig`
 * 一起住在 src/lib/import-pipeline.ts；2024 流水线整体移除后，仅两票导入 API 还需要它，
 * 故就近内联（单一 adapter = 假 seam，不值得为它保留独立模块）。
 */
async function loadTicketPrices(prisma: PrismaClient): Promise<TicketPriceConfig> {
  const row = await prisma.scoringRule.findUnique({
    where: { dimensionCode: 'worksite.ticket-execution' },
  });
  let cfg: Record<string, unknown> = {};
  if (row?.config) {
    cfg = row.config as Record<string, unknown>;
  } else {
    const seed = defaultScoringRuleConfigs().find(
      (c) => c.dimensionCode === 'worksite.ticket-execution',
    );
    cfg = (seed?.config as Record<string, unknown>) ?? {};
  }
  const ticketPrices =
    (cfg.ticketPrices as {
      workLeader?: Record<string, number>;
      workPermitter?: Record<string, number>;
      workMember?: Record<string, number>;
    } | undefined) ?? undefined;
  const operationStepPrice =
    (cfg.operationStepPrice as number | undefined) ??
    DEFAULT_TICKET_PRICES.operationStepPrice;
  return {
    operationStepPrice,
    workLeader: ticketPrices?.workLeader ?? DEFAULT_TICKET_PRICES.workLeader,
    workPermitter: ticketPrices?.workPermitter ?? DEFAULT_TICKET_PRICES.workPermitter,
    workMember: ticketPrices?.workMember ?? DEFAULT_TICKET_PRICES.workMember,
  };
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
