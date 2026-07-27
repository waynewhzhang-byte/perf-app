/**
 * PerformanceFact 批量写入的单一深 seam。
 *
 * 业务背景：所有按 (year, dimensionCode, sourceFile) 维度导入的事实——缺陷治理、
 * 两票执行、安全贡献——都用同一种语义：管理员重新上传同一份源文件时，**整体替换**
 * 该 scope 下的事实集合（文件中不再出现的旧行视为已被清洗，删除）。
 *
 * 历史：此前的写入散落在 fact-import-persistence.ts 的多个维度适配器 +
 * manual-fact-import.ts 的
 * importScoreFacts（incremental 风格），既有重复 boilerplate，又有语义分歧
 * （tickets batch-replace、defects/safety incremental）。本模块统一为 batch-replace。
 *
 * 接口刻意窄：调用方负责把业务对象（TicketExecutionRecord / ScoredFact 等）
 * 转换成 `PerformanceFactSeed`，本模块不懂计分规则、不懂维度语义——只管事务性写入。
 *
 * 性能：用 `createMany` 分块（默认每块 200 行）代替逐行 upsert，把 N 次 round-trip
 * 压到 ~N/200 次；事务包裹确保中途失败不会留下"删了旧的、新的写一半"的破损状态。
 */
import type { Prisma, PrismaClient, PerformanceFactRole, PerformanceFactEventType } from '@prisma/client';
import { refreshFactBackedSubmissionsByEmployeeNos } from '@/lib/fact-correction';

/** 调用方转换后的中立形态：不含 id/userId/sourceFile（这些由本模块填） */
export interface PerformanceFactSeed {
  year: number;
  employeeNo: string;
  employeeName: string;
  dimensionCode: string;
  dimensionTitle: string;
  role: PerformanceFactRole;
  eventType: PerformanceFactEventType;
  /** Decimal 列；Prisma 接受 number / string / Decimal */
  score: number | string;
  defectRef: string;
  defectLevel: string;
  eventDate: string | null;
  /** 原始业务记录的稳定标识与员工可读标题；旧导入器可暂不提供。 */
  /** 同一批次含多个物理源文件时覆盖 scope.sourceFile（例如四份两票源表）。 */
  sourceFile?: string;
  recordKey?: string | null;
  recordType?: string | null;
  recordTitle?: string | null;
  participationRole?: string | null;
  sourceSheet?: string | null;
  sourceRowNo?: number | null;
  /**
   * JSON 列。故意用宽松的 object 类型，让调用方传业务对象（含嵌套 breakdown 等）
   * 不必先转成 Prisma.InputJsonValue；本模块在写入边界统一 cast。
   */
  metadata: Record<string, unknown>;
}

/** batch-replace 的范围键：删除 + 创建都局限在此 scope 内 */
export interface FactReplaceScope {
  year: number;
  dimensionCode: string;
  sourceFile: string;
  /** 一次性重导时，替换该年度、该维度的所有来源文件。 */
  replaceAcrossSourceFiles?: boolean;
  /** 批量重导可显式跳过受影响申报的即时重算。 */
  refreshSubmissions?: boolean;
  /** 明细补录模式：员工维度原始总分与替换前不一致时拒绝写入。 */
  preserveEmployeeScoreTotals?: boolean;
  /** 发起导入的管理员；CLI 可为空。 */
  createdBy?: string;
}

export interface ReplaceFactsResult {
  deleted: number;
  created: number;
}

export interface EmployeeScoreMismatch {
  employeeNo: string;
  previous: number;
  next: number;
}

export function compareEmployeeScoreTotals(
  previous: Array<{ employeeNo: string; score: unknown }>,
  next: Array<{ employeeNo: string; score: unknown }>,
): EmployeeScoreMismatch[] {
  const totalByEmployee = (rows: Array<{ employeeNo: string; score: unknown }>) => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(
        row.employeeNo,
        Math.round(((totals.get(row.employeeNo) ?? 0) + Number(row.score)) * 100) / 100,
      );
    }
    return totals;
  };
  const previousTotals = totalByEmployee(previous);
  const nextTotals = totalByEmployee(next);
  const employeeNos = new Set([...previousTotals.keys(), ...nextTotals.keys()]);
  return [...employeeNos]
    .filter((employeeNo) => (
      Math.abs((previousTotals.get(employeeNo) ?? 0) - (nextTotals.get(employeeNo) ?? 0)) > 0.001
    ))
    .map((employeeNo) => ({
      employeeNo,
      previous: previousTotals.get(employeeNo) ?? 0,
      next: nextTotals.get(employeeNo) ?? 0,
    }));
}

export class EmployeeScoreTotalsMismatchError extends Error {
  constructor(
    readonly dimensionCode: string,
    readonly reviewId: string,
    readonly mismatches: EmployeeScoreMismatch[],
    readonly coverageIssue?: string,
  ) {
    super(
      coverageIssue
        ? `${dimensionCode} 明细导入未满足人员覆盖要求（${coverageIssue}），已拒绝写入并提交人工复核（${reviewId}）`
        : `${dimensionCode} 明细导入会改变 ${mismatches.length} 名员工的原始分，已拒绝写入并提交人工复核（${reviewId}）`,
    );
    this.name = 'EmployeeScoreTotalsMismatchError';
  }
}

export function assertEmployeeScoreTotalsPreserved(
  previous: Array<{ employeeNo: string; score: unknown }>,
  next: Array<{ employeeNo: string; score: unknown }>,
  label: string,
): void {
  const mismatches = compareEmployeeScoreTotals(previous, next);
  if (mismatches.length > 0) {
    throw new Error(
      `${label} 明细导入会改变 ${mismatches.length} 名员工的原始分，已拒绝写入：${JSON.stringify(mismatches.slice(0, 10))}`,
    );
  }
}

/** createMany 单次块大小；Prisma PostgreSQL 默认 query 参数上限 ~65535，留足余量 */
const CREATE_MANY_CHUNK_SIZE = 200;

/**
 * 按 scope 整体替换事实集合。
 *
 * 步骤（事务内）：
 *   1. `deleteMany` 清空该 scope 下所有旧记录
 *   2. 按 unique key `[year, employeeNo, dimensionCode, defectRef, role, eventType]`
 *      对 seeds 去重（后写覆盖，与原 upsert 行为一致）
 *   3. `createMany` 分块写入
 *
 * 若 seeds 为空，等价于"清空该 scope"——业务上表示"重新上传一份空文件"。
 */
export async function replaceFactsBySource(
  prisma: PrismaClient,
  scope: FactReplaceScope,
  seeds: PerformanceFactSeed[],
  userIdByEmployeeNo: Map<string, string>,
): Promise<ReplaceFactsResult> {
  const where = {
    year: scope.year,
    dimensionCode: scope.dimensionCode,
    ...(scope.replaceAcrossSourceFiles || scope.preserveEmployeeScoreTotals
      ? {}
      : { sourceFile: scope.sourceFile }),
  };
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.performanceFact.findMany({
      where,
      select: { employeeNo: true, score: true },
    });
    const deduped = dedupeSeeds(seeds);
    if (scope.preserveEmployeeScoreTotals) {
      const mismatches = compareEmployeeScoreTotals(previous, deduped);
      const rosterCount = await tx.user.count({ where: { employeeNo: { not: null } } });
      const expectedRosterCount = scope.year === 2026 ? 435 : rosterCount;
      const coverageIssue = rosterCount === expectedRosterCount
        ? undefined
        : `应核对 ${expectedRosterCount} 人，当前名册 ${rosterCount} 人`;
      if (mismatches.length > 0 || coverageIssue) {
        const review = await tx.factImportLog.create({
          data: {
            year: scope.year,
            kind: 'detail-reconciliation',
            sourceFiles: [scope.sourceFile],
            summary: {
              status: 'PENDING_MANUAL_REVIEW',
              dimensionCode: scope.dimensionCode,
              rosterCount,
              expectedRosterCount,
              rosterCoveragePassed: !coverageIssue,
              checkedEmployees: rosterCount,
              existingFactCount: previous.length,
              proposedFactCount: deduped.length,
              mismatchCount: mismatches.length,
              formulaChanged: false,
              checkBasis: '现有员工维度原始总分 vs 拟导入明细逐条得分合计',
              processInvariant: '每名员工维度原始总分一致，既有封顶、专业归一化和最终计分函数保持不变',
            },
            unmatched: {
              scoreMismatches: mismatches.map((mismatch) => ({ ...mismatch })),
              ...(coverageIssue ? { coverageIssue } : {}),
            },
            createdBy: scope.createdBy,
          },
          select: { id: true },
        });
        return {
          blocked: true as const,
          reviewId: review.id,
          mismatches,
          coverageIssue,
          employeeNos: previous.map((fact) => fact.employeeNo),
        };
      }
    }
    const deleted = (
      await tx.performanceFact.deleteMany({
        where,
      })
    ).count;

    if (seeds.length === 0) {
      if (scope.preserveEmployeeScoreTotals) {
        await tx.factImportLog.create({
          data: {
            year: scope.year,
            kind: 'detail-reconciliation',
            sourceFiles: [scope.sourceFile],
            summary: {
              status: 'PASSED',
              dimensionCode: scope.dimensionCode,
              rosterCount: await tx.user.count({ where: { employeeNo: { not: null } } }),
              mismatchCount: 0,
              formulaChanged: false,
            },
            unmatched: {},
            createdBy: scope.createdBy,
          },
        });
      }
      return {
        blocked: false as const,
        deleted,
        created: 0,
        employeeNos: previous.map((fact) => fact.employeeNo),
      };
    }

    const rows = deduped.map((seed) => toPerformanceFactCreateInput(seed, scope, userIdByEmployeeNo));

    let created = 0;
    for (let i = 0; i < rows.length; i += CREATE_MANY_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CREATE_MANY_CHUNK_SIZE);
      const result = await tx.performanceFact.createMany({ data: chunk });
      created += result.count;
    }
    if (scope.preserveEmployeeScoreTotals) {
      const rosterCount = await tx.user.count({ where: { employeeNo: { not: null } } });
      await tx.factImportLog.create({
        data: {
          year: scope.year,
          kind: 'detail-reconciliation',
          sourceFiles: [scope.sourceFile],
          summary: {
            status: 'PASSED',
            dimensionCode: scope.dimensionCode,
            rosterCount,
            checkedEmployees: rosterCount,
            existingFactCount: previous.length,
            proposedFactCount: deduped.length,
            mismatchCount: 0,
            formulaChanged: false,
            checkBasis: '现有员工维度原始总分 vs 拟导入明细逐条得分合计',
            processInvariant: '每名员工维度原始总分一致，既有封顶、专业归一化和最终计分函数保持不变',
          },
          unmatched: {},
          createdBy: scope.createdBy,
        },
      });
    }

    return {
      blocked: false as const,
      deleted,
      created,
      employeeNos: [...previous.map((fact) => fact.employeeNo), ...deduped.map((seed) => seed.employeeNo)],
    };
  }, { timeout: 30_000 });
  if (result.blocked) {
    throw new EmployeeScoreTotalsMismatchError(
      scope.dimensionCode,
      result.reviewId,
      result.mismatches,
      result.coverageIssue,
    );
  }
  if (scope.refreshSubmissions !== false) {
    await refreshFactBackedSubmissionsByEmployeeNos(prisma, scope.year, result.employeeNos);
  }
  return { deleted: result.deleted, created: result.created };
}

/**
 * 按唯一键去重，后写覆盖（与原 upsert 循环语义一致）。
 * 同一份源文件里若同一员工+缺陷+角色+事件出现多次，最后一条胜出。
 */
function dedupeSeeds(seeds: PerformanceFactSeed[]): PerformanceFactSeed[] {
  const map = new Map<string, PerformanceFactSeed>();
  for (const seed of seeds) {
    const key = [
      seed.year,
      seed.employeeNo,
      seed.dimensionCode,
      seed.defectRef,
      seed.role,
      seed.eventType,
    ].join('\u0000');
    map.set(key, seed);
  }
  return Array.from(map.values());
}

function toPerformanceFactCreateInput(
  seed: PerformanceFactSeed,
  scope: FactReplaceScope,
  userIdByEmployeeNo: Map<string, string>,
): Prisma.PerformanceFactCreateManyInput {
  const metadata = seed.metadata as Record<string, unknown>;
  const metadataString = (key: string): string | null => {
    const value = metadata[key];
    return value == null || String(value).trim() === '' ? null : String(value).trim();
  };
  const metadataRowNo = Number(metadata.sourceRowNo);
  return {
    year: seed.year,
    employeeNo: seed.employeeNo,
    employeeName: seed.employeeName,
    userId: userIdByEmployeeNo.get(seed.employeeNo) ?? null,
    dimensionCode: seed.dimensionCode,
    dimensionTitle: seed.dimensionTitle,
    role: seed.role,
    eventType: seed.eventType,
    score: seed.score,
    defectRef: seed.defectRef,
    defectLevel: seed.defectLevel,
    eventDate: seed.eventDate,
    sourceFile: seed.sourceFile ?? scope.sourceFile,
    recordKey: seed.recordKey ?? metadataString('recordKey') ?? seed.defectRef,
    recordType: seed.recordType ?? metadataString('recordType') ?? seed.dimensionCode,
    recordTitle: seed.recordTitle ?? metadataString('recordTitle'),
    participationRole: seed.participationRole ?? null,
    sourceSheet: seed.sourceSheet ?? metadataString('sourceSheet'),
    sourceRowNo: seed.sourceRowNo
      ?? (Number.isInteger(metadataRowNo) && metadataRowNo > 0 ? metadataRowNo : null),
    // 写入边界统一 cast 成 Prisma 接受的 JSON 类型；调用方传的是普通 object
    metadata: metadata as Prisma.InputJsonValue,
  };
}
