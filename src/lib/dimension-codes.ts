/**
 * 系统导入维度码常量（MVP 集合，后续按需扩展）
 *
 * 模板设计时，FormItem.dimensionCode 从此列表选择。
 * 章节名称对应一级维度，子项名称对应二级维度。
 */
export interface DimensionDef {
  code: string;
  name: string;
  category: string;
  dataSource: string;
  /** 该维度在导入时需要映射的字段（FACT_FIELDS key 集合） */
  fields: string[];
}

export const DIMENSION_DEFS: DimensionDef[] = [
  {
    code: 'worksite.defect-governance',
    name: '缺陷治理',
    category: '工作现场',
    dataSource: '运检部缺陷库 Excel',
    fields: ['employeeNo', 'employeeName', 'role', 'eventType', 'defectLevel', 'defectRef', 'eventDate'],
  },
  {
    code: 'worksite.ticket-execution',
    name: '两票执行',
    category: '工作现场',
    dataSource: '两票公示汇总 Excel',
    fields: ['employeeNo', 'employeeName', 'rawScore', 'declarationLevel', 'eventDate'],
  },
  {
    code: 'performance.safety-contribution',
    name: '安全贡献',
    category: '工作业绩',
    dataSource: '安全突出贡献审批单 Excel',
    fields: ['employeeNo', 'employeeName', 'role', 'faultCount', 'incidentId', 'eventDate'],
  },
];

export const DIMENSION_CODE_LABELS: Record<string, string> = Object.fromEntries(
  DIMENSION_DEFS.map((d) => [d.code, d.name]),
);
