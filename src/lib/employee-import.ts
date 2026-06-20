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

import type { PrismaClient } from '@prisma/client';
import {
  buildThreeTierOrgPlan,
  ensureThreeTierOrg,
  deptKey,
  teamKey,
} from './team-org';

/** 位置缓存（避免逐行 findFirst） */
async function ensurePosition(
  prisma: PrismaClient,
  name: string,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!name) return null;
  const hit = cache.get(name);
  if (hit) return hit;
  const existing = await prisma.position.findFirst({ where: { name } });
  const pos = existing ?? (await prisma.position.create({ data: { name } }));
  cache.set(name, pos.id);
  return pos.id;
}

export interface EmployeeImportResult {
  total: number;
  usersCreated: number;
  usersUpdated: number;
  orgPlan: ReturnType<typeof buildThreeTierOrgPlan>;
}

/**
 * 导入员工档案：先 ensure 三层组织，再逐行 User upsert。
 * @param prisma  PrismaClient
 * @param mapping 字段映射
 * @param rows    原始行
 * @param sourceFile 源文件名（保留供日志，由路由层使用）
 */
export async function importEmployees(
  prisma: PrismaClient,
  mapping: EmployeeFieldMapping,
  rows: Record<string, string>[],
  sourceFile: string,
): Promise<EmployeeImportResult> {
  const drafts = buildEmployeeDrafts(mapping, rows);
  const orgPlan = buildThreeTierOrgPlan(drafts);
  const lookup = await ensureThreeTierOrg(prisma, orgPlan);
  const positionCache = new Map<string, string>();

  let usersCreated = 0;
  let usersUpdated = 0;

  for (const d of drafts) {
    const branchId = d.workArea ? lookup.branchIdByWorkArea.get(d.workArea) ?? null : null;
    let departmentId: string | null = null;
    if (d.workArea && d.department) {
      departmentId = lookup.departmentIdByKey.get(deptKey(d.workArea, d.department)) ?? null;
    }
    let teamId: string | null = null;
    if (d.workArea && d.department && d.team) {
      teamId = lookup.teamIdByKey.get(teamKey(d.workArea, d.department, d.team)) ?? null;
    }
    const positionId = await ensurePosition(prisma, d.position, positionCache);

    const existing = await prisma.user.findFirst({
      where: { employeeNo: d.employeeNo },
      select: { id: true },
    });

    const userData = {
      fullName: d.fullName,
      employeeNo: d.employeeNo,
      gender: d.gender || null,
      branchId,
      departmentId,
      teamId,
      positionId,
      profile: d.profile as object,
    };

    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: userData });
      usersUpdated++;
    } else {
      await prisma.user.create({
        data: { contact: d.employeeNo, passwordHash: '', ...userData },
      });
      usersCreated++;
    }
  }

  // sourceFile 保留参数供 FactImportLog 记录（路由层使用），此处不直接落库
  void sourceFile;

  return { total: drafts.length, usersCreated, usersUpdated, orgPlan };
}
