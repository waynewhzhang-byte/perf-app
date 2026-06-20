/**
 * 三层组织架构（工区 → 部门 → 班组）导入支持。
 *
 * 与旧 org-mapping.ts 的区别：不再用正则猜测哪个是工区，
 * 而是直接使用导入时用户映射出的 工区/部门/班组 三列。
 */

/** 映射并标准化后的员工组织行（来自 ImportWizard 的 mapping） */
export interface OrgRow {
  /** 工区（Branch），必填 */
  workArea: string;
  /** 部门（Department），可空 */
  department: string;
  /** 班组（Team），可空 */
  team: string;
}

export interface ThreeTierOrgPlan {
  /** 需 ensure 的工区名（去重、排序） */
  workAreas: string[];
  /** 需 ensure 的部门（挂在工区下，去重、排序） */
  departments: { workArea: string; name: string }[];
  /** 需 ensure 的班组（挂在部门下，去重、排序） */
  teams: { workArea: string; department: string; name: string }[];
}

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/**
 * 由员工行聚合三层组织 ensure 计划。
 * 规则：工区为空 → 整行跳过；部门为空 → 仅记工区；班组为空 → 仅记工区+部门。
 */
export function buildThreeTierOrgPlan(rows: OrgRow[]): ThreeTierOrgPlan {
  const workAreaSet = new Set<string>();
  const deptSet = new Set<string>();
  const teamSet = new Set<string>();

  for (const r of rows) {
    const workArea = norm(r.workArea);
    if (!workArea) continue;
    workAreaSet.add(workArea);

    const department = norm(r.department);
    if (!department) continue;
    deptSet.add(`${workArea}\0${department}`);

    const team = norm(r.team);
    if (!team) continue;
    teamSet.add(`${workArea}\0${department}\0${team}`);
  }

  const zh = (a: string, b: string) => a.localeCompare(b, 'zh-CN');
  return {
    workAreas: [...workAreaSet].sort(zh),
    departments: [...deptSet]
      .map((k) => {
        const [workArea, name] = k.split('\0');
        return { workArea, name };
      })
      .sort((a, b) => zh(a.workArea, b.workArea) || zh(a.name, b.name)),
    teams: [...teamSet]
      .map((k) => {
        const [workArea, department, name] = k.split('\0');
        return { workArea, department, name };
      })
      .sort((a, b) =>
        zh(a.workArea, b.workArea) || zh(a.department, b.department) || zh(a.name, b.name)),
  };
}
