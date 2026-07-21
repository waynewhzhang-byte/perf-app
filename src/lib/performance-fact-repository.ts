/**
 * PerformanceFact 批量写入的单一深 seam。
 *
 * 业务背景：所有按 (year, dimensionCode, sourceFile) 维度导入的事实——缺陷治理、
 * 两票执行、安全贡献——都用同一种语义：管理员重新上传同一份源文件时，**整体替换**
 * 该 scope 下的事实集合（文件中不再出现的旧行视为已被清洗，删除）。
 *
 * 历史：此前的写入散落在 fact-import-persistence.ts 的三个函数（persistDefectFacts /
 * persistTicketAggregates / persistSafetyFacts）+ manual-fact-import.ts 的
 * importScoreFacts（incremental 风格），既有重复 boilerplate，又有语义分歧
 * （tickets batch-replace、defects/safety incremental）。本模块统一为 batch-replace。
 *
 * 接口刻意窄：调用方负责把业务对象（TicketExecutionAggregate / ScoredFact 等）
 * 转换成 `PerformanceFactSeed`，本模块不懂计分规则、不懂维度语义——只管事务性写入。
 *
 * 性能：用 `createMany` 分块（默认每块 200 行）代替逐行 upsert，把 N 次 round-trip
 * 压到 ~N/200 次；事务包裹确保中途失败不会留下"删了旧的、新的写一半"的破损状态。
 */
import type { Prisma, PrismaClient, PerformanceFactRole, PerformanceFactEventType } from '@prisma/client';

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
}

export interface ReplaceFactsResult {
  deleted: number;
  created: number;
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
  return prisma.$transaction(async (tx) => {
    const deleted = (
      await tx.performanceFact.deleteMany({
        where: {
          year: scope.year,
          dimensionCode: scope.dimensionCode,
          sourceFile: scope.sourceFile,
        },
      })
    ).count;

    if (seeds.length === 0) {
      return { deleted, created: 0 };
    }

    const deduped = dedupeSeeds(seeds);
    const rows = deduped.map((seed) => toPerformanceFactCreateInput(seed, scope, userIdByEmployeeNo));

    let created = 0;
    for (let i = 0; i < rows.length; i += CREATE_MANY_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CREATE_MANY_CHUNK_SIZE);
      const result = await tx.performanceFact.createMany({ data: chunk });
      created += result.count;
    }

    return { deleted, created };
  });
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
    sourceFile: scope.sourceFile,
    // 写入边界统一 cast 成 Prisma 接受的 JSON 类型；调用方传的是普通 object
    metadata: seed.metadata as Prisma.InputJsonValue,
  };
}
