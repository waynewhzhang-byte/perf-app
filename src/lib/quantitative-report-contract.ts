export const ALL_QUANTITATIVE_REPORT_UNITS = '__ALL__';
export const HEADQUARTERS_BRANCH_NAME = '综合服务中心（物资保障中心）';

export function quantitativeReportBranchOptionLabel(name: string): string {
  return name === HEADQUARTERS_BRANCH_NAME ? `总部职员（${name}）` : name;
}

export function quantitativeReportUnitLabel(unit: string): string {
  return unit === ALL_QUANTITATIVE_REPORT_UNITS ? '全部部门' : unit;
}

export function quantitativeReportFilename(unit: string): string {
  return `超高压变电--量化积分表积分报送表.（${quantitativeReportUnitLabel(unit)}）-自动生成.xlsx`;
}
