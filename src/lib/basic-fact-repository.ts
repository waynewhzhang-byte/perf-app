/**
 * EmployeeBasicFact 批量写入的 seam，与 performance-fact-repository.ts 对称。
 *
 * 业务背景：基本素质三维度（技能/职称/绩效）来自员工档案，按年度+维度记录。
 * 管理员重新上传同一份源文件时，**整体替换**该 scope 下的事实集合——
 * 文件中不再出现的旧档位值视为已被清洗，删除。
 *
 * 与 PerformanceFact 不同点：
 *   - unique key 是 `[year, employeeNo, dimension]`（每人每年每维度只有一条）
 *   - 没有 role/eventType/defectRef 字段
 *   - scope 同样按 `(year, dimension, sourceFile)`，支持同维度多源数据并存
 *
 * 性能：用 createMany 分块（默认 200 行）+ 单次事务 deleteMany + createMany，
 * 把逐行 upsert 的 N 次 round-trip 压到 ~N/200 次。
 *
 * **规范**：所有 EmployeeBasicFact 写入必须经本模块。禁止直接 `prisma.employeeBasicFact.create/upsert/update`
 * 写入业务事实（申诉修正 fact-corrections 是唯一例外，单条修改需审计）。
 */
import type { Prisma, PrismaClient, BasicDimension } from '@prisma/client';

/** 调用方转换后的中立形态：不含 id/userId/sourceFile（由本模块填） */
export interface BasicFactSeed {
  year: number;
  employeeNo: string;
  employeeName: string;
  dimension: BasicDimension;
  /** 原始档位值，如「技师」「副高级」「2A1B」；绩效=三年组合码 */
  tierValue: string;
  /** 三年明细（仅 PERFORMANCE_LEVEL 用），其他维度传 null */
  yearBreakdown: Record<string, string | null> | null;
  /** Decimal 列；Prisma 接受 number / string / Decimal */
  score: number | string;
}

/** batch-replace 的范围键：删除 + 创建都局限在此 scope 内 */
export interface BasicFactReplaceScope {
  year: number;
  dimension: BasicDimension;
  sourceFile: string;
}

export interface ReplaceBasicFactsResult {
  deleted: number;
  created: number;
}

/** createMany 单次块大小；与 performance-fact-repository 一致 */
const CREATE_MANY_CHUNK_SIZE = 200;

/**
 * 按 scope 整体替换事实集合。
 *
 * 步骤（事务内）：
 *   1. `deleteMany` 清空该 scope 下所有旧记录
 *   2. 按 unique key `[year, employeeNo, dimension]` 去重（后写覆盖）
 *   3. `createMany` 分块写入
 *
 * 若 seeds 为空，等价于"清空该 scope"——业务上表示"重新上传一份空文件"。
 *
 * scope 仅含 (year, dimension, sourceFile)：同维度不同 sourceFile 的记录**保留**，
 * 用于支持基本素质来源多样（如技能等级一份源、绩效等级另一份源）。
 */
export async function replaceBasicFactsBySource(
  prisma: PrismaClient,
  scope: BasicFactReplaceScope,
  seeds: BasicFactSeed[],
  userIdByNo: Map<string, string>,
): Promise<ReplaceBasicFactsResult> {
  return prisma.$transaction(async (tx) => {
    const deleted = (
      await tx.employeeBasicFact.deleteMany({
        where: {
          year: scope.year,
          dimension: scope.dimension,
          sourceFile: scope.sourceFile,
        },
      })
    ).count;

    if (seeds.length === 0) {
      return { deleted, created: 0 };
    }

    const deduped = dedupeSeeds(seeds);
    const rows = deduped.map((seed) => toBasicFactCreateInput(seed, scope, userIdByNo));

    let created = 0;
    for (let i = 0; i < rows.length; i += CREATE_MANY_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CREATE_MANY_CHUNK_SIZE);
      const result = await tx.employeeBasicFact.createMany({ data: chunk });
      created += result.count;
    }

    return { deleted, created };
  });
}

/**
 * 按唯一键去重，后写覆盖（与原 upsert 循环语义一致）。
 * 同一份源文件里若同一员工+维度出现多次，最后一条胜出。
 */
function dedupeSeeds(seeds: BasicFactSeed[]): BasicFactSeed[] {
  const map = new Map<string, BasicFactSeed>();
  for (const seed of seeds) {
    const key = [seed.year, seed.employeeNo, seed.dimension].join('\u0000');
    map.set(key, seed);
  }
  return Array.from(map.values());
}

function toBasicFactCreateInput(
  seed: BasicFactSeed,
  scope: BasicFactReplaceScope,
  userIdByNo: Map<string, string>,
): Prisma.EmployeeBasicFactCreateManyInput {
  return {
    year: seed.year,
    employeeNo: seed.employeeNo,
    employeeName: seed.employeeName,
    userId: userIdByNo.get(seed.employeeNo) ?? null,
    dimension: seed.dimension,
    tierValue: seed.tierValue,
    // null → undefined（createMany 不接受 null 给 Json? 列；undefined 表示用 schema 默认）
    yearBreakdown: seed.yearBreakdown ?? undefined,
    score: seed.score,
    sourceFile: scope.sourceFile,
  };
}
