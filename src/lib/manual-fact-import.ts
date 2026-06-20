/**
 * 两票/缺陷/安全三类评分事实的统一导入。
 *
 * 计分复用 scoring-engine.ts 的 computeFactScores 与 DB ScoringRule，
 * 本模块只负责：行 → FactInput 构造 → 调引擎 → 写 PerformanceFact。
 */
import type { FactInput, FactRole, FactEventType } from './scoring-engine';
/** 评分事实字段映射（联合类型，按维度用到不同子集） */
export interface FactFieldMapping {
  employeeNo: string;
  employeeName: string;
  role?: string;
  eventType?: string;
  defectLevel?: string;
  defectRef?: string;
  rawScore?: string;
  declarationLevel?: string;
  faultCount?: string;
  incidentId?: string;
  eventDate?: string;
}

const ROLE_MAP: Record<string, FactRole> = {
  '第一发现人': 'FIRST_DISCOVERER', FIRST_DISCOVERER: 'FIRST_DISCOVERER',
  '共同发现人': 'CO_DISCOVERER', CO_DISCOVERER: 'CO_DISCOVERER',
  '第一处理人': 'FIRST_HANDLER', FIRST_HANDLER: 'FIRST_HANDLER',
  '共同处理人': 'CO_HANDLER', CO_HANDLER: 'CO_HANDLER',
};

const EVENT_TYPE_MAP: Record<string, FactEventType> = {
  '发现': 'DISCOVERY', DISCOVERY: 'DISCOVERY',
  '处理': 'REMEDIATION', REMEDIATION: 'REMEDIATION', '消缺': 'REMEDIATION',
};

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/** 行 → FactInput（按 dimensionCode 解读字段）。工号缺失跳过。 */
export function rowsToFactInputs(
  dimensionCode: string,
  mapping: FactFieldMapping,
  rows: Record<string, string>[],
  sourceFile = 'manual-upload',
): FactInput[] {
  const get = (row: Record<string, string>, key?: string): string | undefined => {
    if (!key) return undefined;
    const v = norm(row[key]);
    return v || undefined;
  };
  const inputs: FactInput[] = [];
  for (const row of rows) {
    const employeeNo = get(row, mapping.employeeNo);
    const employeeName = get(row, mapping.employeeName);
    if (!employeeNo) continue;

    inputs.push({
      employeeNo,
      employeeName: employeeName ?? '',
      dimensionCode,
      role: ROLE_MAP[get(row, mapping.role) ?? ''] ?? 'FIRST_DISCOVERER',
      eventType: EVENT_TYPE_MAP[get(row, mapping.eventType) ?? ''] ?? 'DISCOVERY',
      defectLevel: get(row, mapping.defectLevel) ?? '',
      defectRef: get(row, mapping.defectRef) ?? employeeNo,
      eventDate: get(row, mapping.eventDate),
      sourceFile,
      incidentId: get(row, mapping.incidentId),
      faultCount: get(row, mapping.faultCount) ? parseInt(get(row, mapping.faultCount)!, 10) || 1 : 1,
      rawScore: get(row, mapping.rawScore) ? parseFloat(get(row, mapping.rawScore)!) : undefined,
      declarationLevel: get(row, mapping.declarationLevel),
    });
  }
  return inputs;
}

import type { PrismaClient } from '@prisma/client';
import { computeFactScores, type ScoringRule } from './scoring-engine';

/** 从 DB 读维度 ScoringRule（无配置报错） */
async function loadScoringRule(
  prisma: PrismaClient,
  dimensionCode: string,
): Promise<ScoringRule> {
  const row = await prisma.scoringRule.findUnique({ where: { dimensionCode } });
  if (!row) throw new Error(`未找到维度「${dimensionCode}」的评分规则`);
  return {
    id: row.id,
    dimensionCode: row.dimensionCode,
    ruleType: row.ruleType as ScoringRule['ruleType'],
    cap: Number(row.cap),
    enabled: row.enabled,
    ...(row.config as Record<string, unknown>),
  };
}

export interface ScoreFactImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  unmatched: { name: string; reason: string }[];
}

/**
 * 导入评分事实：行 → FactInput → computeFactScores → PerformanceFact upsert。
 * @param dimensionCode worksite.ticket-execution | worksite.defect-governance | performance.safety-contribution
 */
export async function importScoreFacts(
  prisma: PrismaClient,
  dimensionCode: string,
  dimensionTitle: string,
  year: number,
  mapping: FactFieldMapping,
  rows: Record<string, string>[],
  sourceFile: string,
): Promise<ScoreFactImportResult> {
  const rule = await loadScoringRule(prisma, dimensionCode);
  if (!rule.enabled) throw new Error('该维度评分规则已禁用');

  const inputs = rowsToFactInputs(dimensionCode, mapping, rows, sourceFile);
  if (inputs.length === 0) throw new Error('没有可导入的有效数据行');

  const scored = computeFactScores(inputs, [rule]);

  let created = 0;
  let updated = 0;
  const skipped = 0;

  for (const f of scored) {
    const user = await prisma.user.findFirst({
      where: { employeeNo: f.employeeNo },
      select: { id: true },
    });

    const existing = await prisma.performanceFact.findFirst({
      where: {
        year, employeeNo: f.employeeNo, dimensionCode,
        defectRef: f.defectRef || f.employeeNo,
        role: f.role as never, eventType: f.eventType as never,
      },
    });

    const data = {
      year, employeeNo: f.employeeNo, employeeName: f.employeeName,
      userId: user?.id ?? null, dimensionCode, dimensionTitle,
      role: f.role as never, eventType: f.eventType as never,
      score: f.score, defectRef: f.defectRef || f.employeeNo,
      defectLevel: f.defectLevel ?? '', eventDate: f.eventDate ?? null,
      sourceFile, metadata: (f.metadata ?? {}) as object,
    };

    if (existing) {
      await prisma.performanceFact.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.performanceFact.create({ data });
      created++;
    }
  }

  return { total: scored.length, created, updated, skipped, unmatched: [] };
}
