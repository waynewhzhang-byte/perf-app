/**
 * 将《基本素质信息》中的「部门」映射到系统组织架构：
 * - 二级单位 → Branch（分部、中心、特高压站等）
 * - 总部部门 → 公司总部 Branch 下的 Department
 * - 班组/处室 → 所属二级单位下的 Department
 */

export const HQ_BRANCH_NAME = '公司总部';

/** Excel「部门」列中视为二级单位（Branch）的名称模式 */
const BRANCH_PATTERNS: RegExp[] = [
  /运维分部$/,
  /检修中心$/,
  /管控中心$/,
  /测试中心$/,
  /服务中心$/,
  /特高压.+站$/,
  /换流站$/,
  /^领导干部$/,
  /^其他机构$/,
];

export type OrgUnitKind = 'branch' | 'hq_department';

export interface ParsedOrgFromExcel {
  /** Excel 原始「部门」值 */
  departmentRaw: string;
  /** Excel 原始「班组/处室」值（可为空） */
  teamRaw: string;
  kind: OrgUnitKind;
  /** 对应 Branch.name */
  branchName: string;
  /** 对应 Department.name（总部员工=部门名；二级单位员工=班组名） */
  departmentName: string | null;
}

/** 判断 Excel「部门」是否属于二级单位 */
export function isBranchDepartment(deptName: string): boolean {
  const s = deptName.trim();
  if (!s) return false;
  return BRANCH_PATTERNS.some((p) => p.test(s));
}

/** 从 Excel 行解析组织归属 */
export function parseOrgFromExcelRow(
  departmentRaw: string | null | undefined,
  teamRaw: string | null | undefined,
): ParsedOrgFromExcel | null {
  const dept = String(departmentRaw ?? '').trim();
  if (!dept) return null;

  const team = String(teamRaw ?? '').trim();

  if (isBranchDepartment(dept)) {
    return {
      departmentRaw: dept,
      teamRaw: team,
      kind: 'branch',
      branchName: dept,
      departmentName: team || null,
    };
  }

  return {
    departmentRaw: dept,
    teamRaw: team,
    kind: 'hq_department',
    branchName: HQ_BRANCH_NAME,
    departmentName: dept,
  };
}

export interface OrgBootstrapPlan {
  branches: string[];
  departments: { branchName: string; name: string }[];
}

/** 从员工行汇总需创建的分公司/部门 */
export function buildOrgBootstrapPlan(
  rows: Array<{ departmentRaw: string; teamRaw: string }>,
): OrgBootstrapPlan {
  const branchSet = new Set<string>([HQ_BRANCH_NAME]);
  const deptSet = new Set<string>();

  for (const row of rows) {
    const parsed = parseOrgFromExcelRow(row.departmentRaw, row.teamRaw);
    if (!parsed) continue;
    branchSet.add(parsed.branchName);
    if (parsed.departmentName) {
      deptSet.add(`${parsed.branchName}\0${parsed.departmentName}`);
    }
  }

  return {
    branches: [...branchSet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    departments: [...deptSet]
      .map((k) => {
        const [branchName, name] = k.split('\0');
        return { branchName, name };
      })
      .sort((a, b) => a.branchName.localeCompare(b.branchName, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN')),
  };
}
