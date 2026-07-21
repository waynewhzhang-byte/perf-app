/**
 * 发明专利事实导入（performance.innovation.paper-patent）
 *
 * 规则（评分标准 对应表.xlsx 行 36 + 量化积分表讨论稿第四稿）：
 *   按顺序具有参评能级评价资格的分别得分为 4分 / 3分 / 2分 / 1分
 *   （业务确认前 4 人计分，详见 docs/agents/fact-import-conventions.md Q2）
 *
 * 源数据形态（9.发明专利.xlsx）：每行 1 个专利，发明人 1~4 列分别对应人员编号 1~4 列：
 *   发明人1 | 人员编号 | 发明人2 | 人员编号 | 发明人3 | 人员编号 | 发明人4 | 人员编号
 *
 * 转换策略：每行源数据展开为最多 4 条 PerformanceFactSeed（每位发明人 1 条）。
 *
 * **B3 修复**：defectRef 必须包含专利名 + 顺序，避免同一员工在不同专利的同序号
 * 被 dedupeSeeds 按 (employeeNo, dimensionCode, defectRef, role, eventType) 合并。
 * 历史数据中李勇（11425691）在 4 个专利都是第 1 发明人，被去重成 1 条，漏算 12 分。
 *
 * **规范**：写入必须经 replaceFactsBySource（本模块 persistPatentFacts 已遵守）。
 */
import type { PrismaClient } from '@prisma/client';
import type { PerformanceFactSeed } from '@/lib/performance-fact-repository';
import { persistSeedsBySource, cellStr, type SeedBasedImportResult } from '@/lib/fact-import-common';

/** 发明人顺序 → 得分（前 4 人 4/3/2/1） */
const PATENT_ORDER_SCORE: Record<number, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };

/** 默认发明人列数量（源数据最多列 4 位） */
const MAX_INVENTORS = 4;

export interface PatentFieldMapping {
  /** 专利名称/标题列（用于生成唯一 defectRef） */
  patentName: string;
  /** 发明人姓名 + 工号交替列：[name1, no1, name2, no2, ...] */
  inventorCols: string[];
}

export interface PatentRow {
  patentName: string;
  inventors: Array<{ name: string; employeeNo: string; order: number }>;
}

export const DEFAULT_PATENT_MAPPING: PatentFieldMapping = {
  patentName: '原始申请(专利权)人',
  inventorCols: [
    '发明人1', '人员编号',
    '发明人2', '人员编号',
    '发明人3', '人员编号',
    '发明人4', '人员编号',
  ],
};

/**
 * 把源数据行展开为发明人列表。跳过工号缺失的发明人位次。
 * 同一行内同一工号出现在多位次时，保留首次出现（按列顺序）。
 */
export function parsePatentRows(
  rows: Record<string, string>[],
  mapping: PatentFieldMapping = DEFAULT_PATENT_MAPPING,
): PatentRow[] {
  const out: PatentRow[] = [];
  for (const row of rows) {
    const patentName = cellStr(row[mapping.patentName]);
    if (!patentName) continue;
    const inventors: PatentRow['inventors'] = [];
    const seenNos = new Set<string>();
    for (let i = 0; i < MAX_INVENTORS; i += 1) {
      const nameCol = mapping.inventorCols[i * 2];
      const noCol = mapping.inventorCols[i * 2 + 1];
      if (!nameCol || !noCol) continue;
      const name = cellStr(row[nameCol]);
      const employeeNo = cellStr(row[noCol]);
      if (!employeeNo) continue;
      if (seenNos.has(employeeNo)) continue;
      seenNos.add(employeeNo);
      inventors.push({ name: name || employeeNo, employeeNo, order: i + 1 });
    }
    if (inventors.length > 0) out.push({ patentName, inventors });
  }
  return out;
}

/**
 * 把发明人列表转 PerformanceFactSeed[]。
 *
 * defectRef 格式：`patent:{order}:{patentName}` —— 必须包含 order 以避免同一员工
 * 在不同专利同序号被 dedupeSeeds 合并（B3 根因）。
 */
export function buildPatentSeeds(
  parsed: PatentRow[],
  year: number,
  sourceFile: string,
): PerformanceFactSeed[] {
  const seeds: PerformanceFactSeed[] = [];
  for (const row of parsed) {
    for (const inv of row.inventors) {
      const score = PATENT_ORDER_SCORE[inv.order] ?? 0;
      if (score <= 0) continue;
      seeds.push({
        year,
        employeeNo: inv.employeeNo,
        employeeName: inv.name,
        dimensionCode: 'performance.innovation.paper-patent',
        dimensionTitle: '发明专利',
        role: 'FIRST_HANDLER',
        eventType: 'REMEDIATION',
        score,
        defectRef: `patent:order${inv.order}:${row.patentName}`.slice(0, 200),
        defectLevel: '',
        eventDate: null,
        metadata: {
          patentName: row.patentName,
          order: inv.order,
        },
      });
    }
  }
  return seeds;
}

/** 导入发明专利事实（batch-replace） */
export async function importPatentFacts(
  prisma: PrismaClient,
  year: number,
  sourceFile: string,
  rows: Record<string, string>[],
  mapping: PatentFieldMapping = DEFAULT_PATENT_MAPPING,
): Promise<SeedBasedImportResult> {
  const parsed = parsePatentRows(rows, mapping);
  const seeds = buildPatentSeeds(parsed, year, sourceFile);
  return persistSeedsBySource(
    prisma,
    { year, dimensionCode: 'performance.innovation.paper-patent', sourceFile },
    seeds,
  );
}
