/**
 * 《评分标准 对应表.xlsx》绩效维度注册表
 *
 * 层级约定（与自定义申报表单对齐）：
 * - 一级「评价维度」→ FormSection.sectionCode（表单章节）
 * - 二级「评价内容」→ FormItem.dimensionCode（申报项 / 计分维度）
 * - 三级「评价标准」→ FormItem.scoreOptions（档次或按次计分规则）
 */
import type { EvaluationDimensionCode } from '@/lib/evaluation-dimensions';
import { SCORING_STANDARDS, type ScoringDataSource } from '@/lib/scoring-standards';

export type PerformanceSectionCode = 'basic' | 'performance' | 'worksite' | 'special';

/** 一级维度：Excel「评价维度」列 */
export interface PerformanceSectionDef {
  code: PerformanceSectionCode;
  title: string;
  maxScore: number;
  excelOrder: number;
  description: string;
}

/** 二级维度：Excel「评价内容」+ 系统 dimensionCode */
export interface PerformanceSubDimensionDef {
  code: EvaluationDimensionCode;
  sectionCode: PerformanceSectionCode;
  title: string;
  maxScore: number;
  dataSource: ScoringDataSource;
  ownerDepartment: string;
  scoringSummary: string;
  referenceFile?: string;
  notes?: string;
  /** 是否由外部台账导入后系统自动计分（员工确认/申诉） */
  isSystemImport: boolean;
}

/** Excel 序号 1–4 一级维度 */
export const PERFORMANCE_SECTIONS: PerformanceSectionDef[] = [
  {
    code: 'basic',
    title: '基本素质',
    maxScore: 14,
    excelOrder: 1,
    description: '公示部门：组织部。依据人资2.0员工全景档案。',
  },
  {
    code: 'performance',
    title: '工作业绩',
    maxScore: 44,
    excelOrder: 2,
    description: '含安全贡献、技术贡献、竞赛比武、发明创新。',
  },
  {
    code: 'worksite',
    title: '工作现场',
    maxScore: 42,
    excelOrder: 3,
    description: '含两票执行、缺陷治理。',
  },
  {
    code: 'special',
    title: '特殊事项',
    maxScore: 0,
    excelOrder: 4,
    description: '加分项与违章扣分项。',
  },
];

const SECTION_BY_CODE = Object.fromEntries(
  PERFORMANCE_SECTIONS.map((s) => [s.code, s]),
) as Record<PerformanceSectionCode, PerformanceSectionDef>;

/** 二级维度：与 SCORING_STANDARDS 一一对应 */
export const PERFORMANCE_SUB_DIMENSIONS: PerformanceSubDimensionDef[] = SCORING_STANDARDS.map(
  (std) => ({
    code: std.code,
    sectionCode: std.sectionCode,
    title: std.title,
    maxScore: std.maxScore,
    dataSource: std.dataSource,
    ownerDepartment: std.ownerDepartment,
    scoringSummary: std.scoringSummary,
    referenceFile: std.referenceFile,
    notes: std.notes,
    isSystemImport: std.dataSource === 'fact',
  }),
);

export const SUB_DIMENSION_BY_CODE = Object.fromEntries(
  PERFORMANCE_SUB_DIMENSIONS.map((d) => [d.code, d]),
) as Record<EvaluationDimensionCode, PerformanceSubDimensionDef>;

export function getPerformanceSection(code: PerformanceSectionCode): PerformanceSectionDef {
  return SECTION_BY_CODE[code];
}

export function subDimensionsForSection(
  sectionCode: PerformanceSectionCode,
): PerformanceSubDimensionDef[] {
  return PERFORMANCE_SUB_DIMENSIONS.filter((d) => d.sectionCode === sectionCode);
}

export function sectionForSubDimension(
  code: string | null | undefined,
): PerformanceSectionDef | undefined {
  if (!code) return undefined;
  const sub = SUB_DIMENSION_BY_CODE[code as EvaluationDimensionCode];
  return sub ? SECTION_BY_CODE[sub.sectionCode] : undefined;
}

export function isSubDimensionInSection(
  dimensionCode: string | null | undefined,
  sectionCode: PerformanceSectionCode | null | undefined,
): boolean {
  if (!dimensionCode || !sectionCode) return true;
  const sub = SUB_DIMENSION_BY_CODE[dimensionCode as EvaluationDimensionCode];
  return sub?.sectionCode === sectionCode;
}

/** 章节默认标题（含满分），用于模板设计器 */
export function defaultSectionTitle(sectionCode: PerformanceSectionCode, index?: number): string {
  const sec = SECTION_BY_CODE[sectionCode];
  const prefix = index != null ? `${['一', '二', '三', '四'][index] ?? index + 1}、` : '';
  const scoreLabel = sec.maxScore > 0 ? `（满分${sec.maxScore}分）` : '';
  return `${prefix}${sec.title}${scoreLabel}`;
}

/** 完整维度树（供 API / 设计器） */
export function buildPerformanceDimensionTree() {
  return PERFORMANCE_SECTIONS.map((section) => ({
    ...section,
    subDimensions: subDimensionsForSection(section.code),
  }));
}

/** @deprecated 兼容旧 import — 扁平列表 */
export interface DimensionDef {
  code: string;
  name: string;
  category: string;
  sectionCode: PerformanceSectionCode;
  maxScore: number;
  dataSource: ScoringDataSource;
  isSystemImport: boolean;
  fields: string[];
}

const LEGACY_FACT_FIELDS: Record<string, string[]> = {
  'worksite.defect-governance': [
    'employeeNo', 'employeeName', 'role', 'eventType', 'defectLevel', 'defectRef', 'eventDate',
  ],
  'worksite.ticket-execution': [
    'employeeNo', 'employeeName', 'rawScore', 'declarationLevel', 'eventDate',
  ],
  'performance.safety-contribution': [
    'employeeNo', 'employeeName', 'role', 'faultCount', 'incidentId', 'eventDate',
  ],
  'basic.skill-level': ['employeeNo', 'employeeName', 'tierValue'],
  'basic.title-level': ['employeeNo', 'employeeName', 'tierValue'],
  'basic.performance-level': ['employeeNo', 'employeeName', 'tierValue'],
};

export const DIMENSION_DEFS: DimensionDef[] = PERFORMANCE_SUB_DIMENSIONS.map((d) => ({
  code: d.code,
  name: d.title,
  category: SECTION_BY_CODE[d.sectionCode].title,
  sectionCode: d.sectionCode,
  maxScore: d.maxScore,
  dataSource: d.dataSource,
  isSystemImport: d.isSystemImport,
  fields: LEGACY_FACT_FIELDS[d.code] ?? [],
}));

export const DIMENSION_CODE_LABELS: Record<string, string> = Object.fromEntries(
  PERFORMANCE_SUB_DIMENSIONS.map((d) => [d.code, d.title]),
);

export const SECTION_CODE_LABELS: Record<PerformanceSectionCode, string> = Object.fromEntries(
  PERFORMANCE_SECTIONS.map((s) => [s.code, s.title]),
) as Record<PerformanceSectionCode, string>;
