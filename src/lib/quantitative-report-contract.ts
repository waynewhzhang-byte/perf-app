import type { DeclarationTier } from './declaration-level';

export const ALL_QUANTITATIVE_REPORT_UNITS = '__ALL__';
export const HEADQUARTERS_BRANCH_NAME = '综合服务中心（物资保障中心）';

/**
 * 量化积分报告中的一行：一名员工在所有维度上的得分明细。
 * 由 `annual-quantitative-report.ts` 构造，供 XLSX 写出与下游消费方共享。
 */
export interface QuantitativeReportRow {
  seq: number;
  employeeNo: string;
  fullName: string;
  gender: string;
  unit: string;
  specialty: string;
  position: string;
  workYears: string;
  skillLevel: number;
  titleLevel: number;
  performanceLevel: number;
  safetyContribution: number;
  technicalStandard: number;
  technicalResource: number;
  competitionEvent: number;
  competitionExam: number;
  innovationAward: number;
  innovationPaper: number;
  ticketExecution: number;
  defectGovernance: number;
  violationSevere: number;
  violationGeneral: number;
  tier: DeclarationTier;
  rawDefectScore: number;
  rawSafetyScore: number;
  rawTicketScore: number;
  ticketTierMaxRaw: number;
  factCount: number;
  safetyFactCount: number;
  /** 导入事实推算合计（申诉覆盖前） */
  importedTotalScore: number;
  /** 申诉管理员改分说明，如「技能等级：4→3」；无改分时为空 */
  appealAdjustmentNote: string;
  /** 申诉覆盖相对导入合计的差额 */
  appealAdjustmentDelta: number;
}

export function quantitativeReportBranchOptionLabel(name: string): string {
  return name === HEADQUARTERS_BRANCH_NAME ? `总部职员（${name}）` : name;
}

export function quantitativeReportUnitLabel(unit: string): string {
  return unit === ALL_QUANTITATIVE_REPORT_UNITS ? '全部部门' : unit;
}

export function quantitativeReportFilename(unit: string): string {
  return `超高压变电--量化积分表积分报送表.（${quantitativeReportUnitLabel(unit)}）-自动生成.xlsx`;
}
