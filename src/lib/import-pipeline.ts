/**
 * 事实数据导入流水线（API / CLI 共用）
 */
import { resolve } from 'path';
import type { PrismaClient } from '@prisma/client';
import { importBasicQualityData, parseBasicQualityFile } from '@/lib/basic-quality-import';
import { importDefectGovernanceFacts, DEFAULT_DEFECT_SCORE_MATRIX, type DefectRow, type DefectScoreMatrix } from '@/lib/defect-governance';
import { aggregateTicketExecutionFromFile } from '@/lib/ticket-execution-import';
import {
  loadUserIdByEmployeeNo,
  persistDefectFacts,
  persistTicketAggregates,
  readXlsxSheetRows,
} from '@/lib/fact-import-persistence';
import { DEFECT_LIBRARY_DIMENSION } from '@/lib/evaluation-dimensions';
import { defaultScoringRuleConfigs } from '@/lib/scoring-standards';
import {
  classifyUnmatchedNames,
  createRosterResolverFromUsers,
  type ClassifiedUnmatched,
} from '@/lib/roster-resolver';

/**
 * 从 DB 读某维度的 ScoringRule.config（若未配置则回退默认种子）。
 * 引擎规则参数集中存 ScoringRule.config JSON，导入时按需取出。
 */
export async function loadRuleConfig(
  prisma: PrismaClient,
  dimensionCode: string,
): Promise<Record<string, unknown>> {
  const row = await prisma.scoringRule.findUnique({ where: { dimensionCode } });
  if (row?.config) return row.config as Record<string, unknown>;
  const seed = defaultScoringRuleConfigs().find((c) => c.dimensionCode === dimensionCode);
  return seed?.config ?? {};
}

/** 读缺陷治理计分矩阵（DB 优先，回退默认） */
export async function loadDefectScoreMatrix(
  prisma: PrismaClient,
): Promise<DefectScoreMatrix> {
  const config = await loadRuleConfig(prisma, 'worksite.defect-governance');
  const matrix = (config.matrix ?? {}) as Record<string, Record<string, number>>;
  // 合并：以默认矩阵为底，DB 配置覆盖（保证缺等级/角色时有回退）
  const merged: DefectScoreMatrix = JSON.parse(JSON.stringify(DEFAULT_DEFECT_SCORE_MATRIX));
  for (const [level, roles] of Object.entries(matrix)) {
    if (!merged[level as keyof DefectScoreMatrix]) continue;
    merged[level as keyof DefectScoreMatrix] = {
      ...merged[level as keyof DefectScoreMatrix],
      ...roles,
    };
  }
  return merged;
}

export const DEFAULT_IMPORT_FILES = {
  basic: '《基本素质信息》.xlsx',
  tickets: '《工作现场-两票执行》.xlsx',
  defects: '《工作现场-缺陷治理》.xlsx',
} as const;

export interface ImportPipelineOptions {
  year: number;
  basicFile?: string;
  ticketFile?: string;
  defectFile?: string;
  unitFilter?: string;
  dryRun?: boolean;
  skipBasic?: boolean;
  skipTickets?: boolean;
  skipDefects?: boolean;
  createdBy?: string;
}

export interface ImportPipelineResult {
  year: number;
  dryRun: boolean;
  basic?: {
    employeeCount: number;
    assessmentCount: number;
    usersCreated: number;
    usersUpdated: number;
    basicFactsWritten: number;
    branches: number;
    departments: number;
  };
  tickets?: {
    operationRows: number;
    workRows: number;
    employeeCount: number;
    factsWritten: number;
    unmatchedTotal: number;
  };
  defects?: {
    factCount: number;
    employeeCount: number;
    collaborativeCount: number;
    factsWritten: number;
    filterNote: string;
    unmatchedTotal: number;
  };
  coverage?: {
    basic: number;
    tickets: number;
    defects: number;
  };
  unmatched: {
    inRoster: ClassifiedUnmatched[];
    external: ClassifiedUnmatched[];
  };
  sourceFiles: Record<string, string>;
}

function resolveProjectPath(filePath: string, cwd: string) {
  return filePath.startsWith('/') ? filePath : resolve(cwd, filePath);
}

export async function runImportPipeline(
  prisma: PrismaClient,
  options: ImportPipelineOptions,
  cwd = process.cwd(),
): Promise<ImportPipelineResult> {
  const basicFile = resolveProjectPath(options.basicFile ?? DEFAULT_IMPORT_FILES.basic, cwd);
  const ticketFile = resolveProjectPath(options.ticketFile ?? DEFAULT_IMPORT_FILES.tickets, cwd);
  const defectFile = resolveProjectPath(options.defectFile ?? DEFAULT_IMPORT_FILES.defects, cwd);
  const { year, dryRun = false, skipBasic, skipTickets, skipDefects, unitFilter, createdBy } = options;

  const result: ImportPipelineResult = {
    year,
    dryRun,
    unmatched: { inRoster: [], external: [] },
    sourceFiles: { basic: basicFile, tickets: ticketFile, defects: defectFile },
  };

  if (!skipBasic) {
    if (dryRun) {
      const parsed = parseBasicQualityFile(basicFile);
      result.basic = {
        employeeCount: parsed.employees.length,
        assessmentCount: parsed.assessments.size,
        usersCreated: 0,
        usersUpdated: 0,
        basicFactsWritten: 0,
        branches: parsed.orgPlan.branches.length,
        departments: parsed.orgPlan.departments.length,
      };
    } else {
      const imported = await importBasicQualityData(prisma, basicFile, year);
      result.basic = {
        employeeCount: imported.employeeCount,
        assessmentCount: imported.assessmentCount,
        usersCreated: imported.usersCreated,
        usersUpdated: imported.usersUpdated,
        basicFactsWritten: imported.basicFactsWritten,
        branches: imported.org.branches.length,
        departments: imported.org.departments.length,
      };
    }
  }

  const users = await prisma.user.findMany({
    where: { employeeNo: { not: null } },
    select: { employeeNo: true, fullName: true },
  });
  const rosterUsers = users
    .filter((u): u is { employeeNo: string; fullName: string } => Boolean(u.employeeNo))
    .map((u) => ({ employeeNo: u.employeeNo, fullName: u.fullName }));

  const resolver = createRosterResolverFromUsers(rosterUsers);
  const allNos = rosterUsers.map((u) => u.employeeNo);
  const userIdByNo = dryRun ? new Map<string, string>() : await loadUserIdByEmployeeNo(prisma, allNos);

  const unmatchedEntries: { name: string; source: 'tickets' | 'defects'; occurrences?: number }[] = [];

  if (!skipTickets) {
    const ticketResult = aggregateTicketExecutionFromFile(ticketFile, resolver, { unitFilter });
    for (const name of ticketResult.unmatchedNames) {
      unmatchedEntries.push({ name, source: 'tickets' });
    }
    result.tickets = {
      operationRows: ticketResult.stats.operationRows,
      workRows: ticketResult.stats.workRows,
      employeeCount: ticketResult.stats.employeeCount,
      factsWritten: 0,
      unmatchedTotal: ticketResult.unmatchedNames.length,
    };
    if (!dryRun) {
      const persisted = await persistTicketAggregates(
        prisma,
        year,
        ticketFile,
        ticketResult.aggregates,
        userIdByNo,
      );
      result.tickets.factsWritten = persisted.created;
    }
  }

  if (!skipDefects) {
    const defectRows = readXlsxSheetRows(defectFile, '问题清单') as DefectRow[];
    const defectResult = importDefectGovernanceFacts(defectRows, year, resolver, {
      requireDefectCategory: true,
    }, await loadDefectScoreMatrix(prisma));
    for (const u of defectResult.unmatchedNames) {
      unmatchedEntries.push({ name: u.name, source: 'defects', occurrences: u.occurrences });
    }
    result.defects = {
      factCount: defectResult.facts.length,
      employeeCount: defectResult.byEmployee.length,
      collaborativeCount: defectResult.facts.filter((f) => f.metadata.isCollaborative).length,
      factsWritten: 0,
      filterNote: defectResult.filterNote,
      unmatchedTotal: defectResult.unmatchedNames.length,
    };
    if (!dryRun) {
      const persisted = await persistDefectFacts(
        prisma,
        year,
        defectFile,
        DEFECT_LIBRARY_DIMENSION.code,
        defectResult.facts,
        userIdByNo,
      );
      result.defects.factsWritten = persisted.created;
    }
  }

  const classified = classifyUnmatchedNames(unmatchedEntries, resolver, rosterUsers);
  result.unmatched = classified;

  if (!dryRun) {
    const [basicCount, ticketCount, defectCount] = await Promise.all([
      prisma.employeeBasicFact.groupBy({ by: ['employeeNo'], where: { year } }),
      prisma.performanceFact.groupBy({
        by: ['employeeNo'],
        where: { year, dimensionCode: 'worksite.ticket-execution' },
      }),
      prisma.performanceFact.groupBy({
        by: ['employeeNo'],
        where: { year, dimensionCode: 'worksite.defect-governance' },
      }),
    ]);
    result.coverage = {
      basic: basicCount.length,
      tickets: ticketCount.length,
      defects: defectCount.length,
    };

    await prisma.factImportLog.create({
      data: {
        year,
        kind: 'pipeline',
        sourceFiles: result.sourceFiles,
        summary: {
          basic: result.basic,
          tickets: result.tickets,
          defects: result.defects,
          coverage: result.coverage,
          dryRun: false,
        },
        unmatched: {
          inRoster: result.unmatched.inRoster,
          externalCount: result.unmatched.external.length,
        } as object,
        createdBy: createdBy ?? null,
      },
    });
  }

  return result;
}
