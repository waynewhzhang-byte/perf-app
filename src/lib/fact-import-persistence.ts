/**
 * 事实数据持久化：PerformanceFact / EmployeeBasicFact 批量写入
 */
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import type { PerformanceFactRole, Prisma, PrismaClient } from '@prisma/client';
import type { DefectFactLine } from '@/lib/defect-governance';
import type { TicketExecutionAggregate } from '@/lib/ticket-execution-import';
import type { SafetyContributionFactLine } from '@/lib/safety-contribution';
import { SAFETY_CONTRIBUTION_DIMENSION } from '@/lib/evaluation-dimensions';
import { TICKET_EXECUTION_DIMENSION } from '@/lib/evaluation-dimensions';

export interface PersistPerformanceFactsResult {
  deleted: number;
  created: number;
}

export async function persistDefectFacts(
  prisma: PrismaClient,
  year: number,
  sourceFile: string,
  dimensionCode: string,
  facts: DefectFactLine[],
  userIdByNo: Map<string, string>,
): Promise<PersistPerformanceFactsResult> {
  const deleted = (
    await prisma.performanceFact.deleteMany({
      where: { year, dimensionCode, sourceFile },
    })
  ).count;

  let created = 0;
  for (const fact of facts) {
    await prisma.performanceFact.upsert({
      where: {
        year_employeeNo_dimensionCode_defectRef_role_eventType: {
          year: fact.year,
          employeeNo: fact.employeeNo,
          dimensionCode: fact.dimensionCode,
          defectRef: fact.defectRef,
          role: fact.role,
          eventType: fact.eventType,
        },
      },
      create: {
        year: fact.year,
        employeeNo: fact.employeeNo,
        employeeName: fact.employeeName,
        userId: userIdByNo.get(fact.employeeNo) ?? null,
        dimensionCode: fact.dimensionCode,
        dimensionTitle: fact.dimensionTitle,
        role: fact.role,
        eventType: fact.eventType,
        score: fact.score,
        defectRef: fact.defectRef,
        defectLevel: fact.defectLevel,
        eventDate: fact.eventDate,
        sourceFile,
        metadata: fact.metadata as Prisma.InputJsonValue,
      },
      update: {
        employeeName: fact.employeeName,
        userId: userIdByNo.get(fact.employeeNo) ?? null,
        score: fact.score,
        defectLevel: fact.defectLevel,
        eventDate: fact.eventDate,
        metadata: fact.metadata as Prisma.InputJsonValue,
      },
    });
    created++;
  }

  return { deleted, created };
}

/** 两票：每人一条汇总事实，score=原始分（折算在申报层完成） */
export async function persistTicketAggregates(
  prisma: PrismaClient,
  year: number,
  sourceFile: string,
  aggregates: TicketExecutionAggregate[],
  userIdByNo: Map<string, string>,
): Promise<PersistPerformanceFactsResult> {
  const dimensionCode = TICKET_EXECUTION_DIMENSION.code;
  const deleted = (
    await prisma.performanceFact.deleteMany({
      where: { year, dimensionCode, sourceFile },
    })
  ).count;

  let created = 0;
  for (const agg of aggregates) {
    const defectRef = `ticket-aggregate-${agg.employeeNo}`;
    await prisma.performanceFact.upsert({
      where: {
        year_employeeNo_dimensionCode_defectRef_role_eventType: {
          year,
          employeeNo: agg.employeeNo,
          dimensionCode,
          defectRef,
          role: 'FIRST_HANDLER' satisfies PerformanceFactRole,
          eventType: 'REMEDIATION',
        },
      },
      create: {
        year,
        employeeNo: agg.employeeNo,
        employeeName: agg.employeeName,
        userId: userIdByNo.get(agg.employeeNo) ?? null,
        dimensionCode,
        dimensionTitle: TICKET_EXECUTION_DIMENSION.title,
        role: 'FIRST_HANDLER',
        eventType: 'REMEDIATION',
        score: agg.rawScore,
        defectRef,
        defectLevel: '',
        eventDate: null,
        sourceFile,
        metadata: {
          rawScore: agg.rawScore,
          isRawScore: true,
          breakdown: agg.breakdown,
        } as unknown as Prisma.InputJsonValue,
      },
      update: {
        employeeName: agg.employeeName,
        userId: userIdByNo.get(agg.employeeNo) ?? null,
        score: agg.rawScore,
        metadata: {
          rawScore: agg.rawScore,
          isRawScore: true,
          breakdown: agg.breakdown,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    created++;
  }

  return { deleted, created };
}

/**
 * 安全贡献：每条事实（一人一事件一角色）写一条 PerformanceFact。
 * score 由 scoreSafetyContributionEntries 按 SHARE 规则算出，封顶在聚合层处理。
 * defectRef 存申报编号（incidentRef），role=FIRST_DISCOVERER/CO_DISCOVERER，eventType=DISCOVERY。
 */
export async function persistSafetyFacts(
  prisma: PrismaClient,
  year: number,
  sourceFile: string,
  facts: SafetyContributionFactLine[],
  userIdByNo: Map<string, string>,
): Promise<PersistPerformanceFactsResult> {
  const dimensionCode = SAFETY_CONTRIBUTION_DIMENSION.code;
  const deleted = (
    await prisma.performanceFact.deleteMany({
      where: { year, dimensionCode, sourceFile },
    })
  ).count;

  let created = 0;
  for (const fact of facts) {
    await prisma.performanceFact.upsert({
      where: {
        year_employeeNo_dimensionCode_defectRef_role_eventType: {
          year: fact.year,
          employeeNo: fact.employeeNo,
          dimensionCode,
          defectRef: fact.incidentRef,
          role: fact.role,
          eventType: 'DISCOVERY',
        },
      },
      create: {
        year: fact.year,
        employeeNo: fact.employeeNo,
        employeeName: fact.employeeName,
        userId: userIdByNo.get(fact.employeeNo) ?? null,
        dimensionCode,
        dimensionTitle: fact.dimensionTitle,
        role: fact.role,
        eventType: 'DISCOVERY',
        score: fact.score,
        defectRef: fact.incidentRef,
        defectLevel: '',
        eventDate: fact.eventDate,
        sourceFile,
        metadata: fact.metadata as unknown as Prisma.InputJsonValue,
      },
      update: {
        employeeName: fact.employeeName,
        userId: userIdByNo.get(fact.employeeNo) ?? null,
        score: fact.score,
        eventDate: fact.eventDate,
        metadata: fact.metadata as unknown as Prisma.InputJsonValue,
      },
    });
    created++;
  }

  return { deleted, created };
}

export async function loadUserIdByEmployeeNo(
  prisma: PrismaClient,
  employeeNos: string[],
): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { employeeNo: { in: employeeNos } },
    select: { id: true, employeeNo: true },
  });
  return new Map(users.filter((u) => u.employeeNo).map((u) => [u.employeeNo!, u.id]));
}

export function readXlsxSheetRows(filePath: string, sheetName: string): Record<string, string | number | null>[] {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`缺少工作表「${sheetName}」`);
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<string, string | number | null>[];
}
