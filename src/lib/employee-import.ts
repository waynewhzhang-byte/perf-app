/**
 * 员工档案与三层组织导入。
 *
 * 分两层：
 * - buildEmployeeDrafts（纯函数）：映射后的行 → 员工草稿（含组织字段 + profile 原始列）
 * - importEmployees（DB）：ensure 组织 + User upsert
 *
 * 与旧 basic-quality-import.ts 区别：组织字段直接来自用户映射列，
 * 不再用 org-mapping 硬拆字符串。
 */

/** 员工导入字段映射（系统字段 key → 文件列头） */
export interface EmployeeFieldMapping {
  employeeNo: string;
  fullName: string;
  workArea: string;
  department: string;
  team: string;
  position: string;
  gender: string;
}

export interface EmployeeDraft {
  employeeNo: string;
  fullName: string;
  workArea: string;
  department: string;
  team: string;
  position: string;
  gender: string;
  /** 未映射的原始列快照 */
  profile: Record<string, string>;
}

const norm = (s: unknown): string => (s == null ? '' : String(s).trim());

/** 由映射 + 原始行生成员工草稿；工号或姓名缺失跳过 */
export function buildEmployeeDrafts(
  mapping: EmployeeFieldMapping,
  rows: Record<string, string>[],
): EmployeeDraft[] {
  const mappedKeys = new Set(Object.values(mapping));
  const drafts: EmployeeDraft[] = [];
  for (const row of rows) {
    const employeeNo = norm(row[mapping.employeeNo]);
    const fullName = norm(row[mapping.fullName]);
    if (!employeeNo || !fullName) continue;
    // 未被映射的列 → profile 快照
    const profile: Record<string, string> = {};
    for (const [col, val] of Object.entries(row)) {
      if (!mappedKeys.has(col) && norm(val)) profile[col] = norm(val);
    }
    drafts.push({
      employeeNo,
      fullName,
      workArea: norm(row[mapping.workArea]),
      department: norm(row[mapping.department]),
      team: norm(row[mapping.team]),
      position: norm(row[mapping.position]),
      gender: norm(row[mapping.gender]),
      profile,
    });
  }
  return drafts;
}
