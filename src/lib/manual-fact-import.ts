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
