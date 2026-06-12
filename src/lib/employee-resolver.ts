import { readFileSync, existsSync } from 'fs';
import { prisma } from '@/lib/prisma';

export interface EmployeeRosterEntry {
  employeeNo: string;
  fullName: string;
}

/** 将姓名规范化为匹配键（去空格、标点） */
export function normalizePersonName(name: string): string {
  return name.replace(/[\s·•,，、;；]/g, '').trim();
}

/** 从 CSV/TSV 读取工号名册：首行含 工号/employeeNo 与 姓名/fullName 列 */
export function loadRosterFromFile(filePath: string): EmployeeRosterEntry[] {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delim).map((h) => h.trim().replace(/^\uFEFF/, ''));
  const noIdx = headers.findIndex((h) => /^(工号|employeeNo|employee_no)$/i.test(h));
  const nameIdx = headers.findIndex((h) => /^(姓名|fullName|name)$/i.test(h));
  if (noIdx < 0 || nameIdx < 0) {
    throw new Error('名册文件需包含「工号」「姓名」列（或 employeeNo / fullName）');
  }

  const roster: EmployeeRosterEntry[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(delim);
    const employeeNo = cols[noIdx]?.trim();
    const fullName = cols[nameIdx]?.trim();
    if (employeeNo && fullName) roster.push({ employeeNo, fullName });
  }
  return roster;
}

export interface EmployeeResolverOptions {
  rosterFile?: string;
  /** 是否用数据库 User 表按姓名补充解析（employeeNo 优先） */
  useDatabase?: boolean;
}

export interface EmployeeResolver {
  resolve(name: string): { employeeNo: string; employeeName: string } | null;
  stats(): { rosterSize: number; dbUsers: number; ambiguousNames: string[] };
}

export async function createEmployeeResolver(
  options: EmployeeResolverOptions = {},
): Promise<EmployeeResolver> {
  const byNormalizedName = new Map<string, EmployeeRosterEntry[]>();

  const addEntry = (entry: EmployeeRosterEntry) => {
    const key = normalizePersonName(entry.fullName);
    const list = byNormalizedName.get(key) ?? [];
    list.push(entry);
    byNormalizedName.set(key, list);
  };

  if (options.rosterFile && existsSync(options.rosterFile)) {
    for (const e of loadRosterFromFile(options.rosterFile)) addEntry(e);
  }

  let dbUsers = 0;
  if (options.useDatabase !== false) {
    const users = await prisma.user.findMany({
      where: { employeeNo: { not: null } },
      select: { employeeNo: true, fullName: true },
    });
    dbUsers = users.length;
    for (const u of users) {
      if (!u.employeeNo) continue;
      addEntry({ employeeNo: u.employeeNo, fullName: u.fullName });
    }
  }

  const ambiguousNames = [...byNormalizedName.entries()]
    .filter(([, list]) => new Set(list.map((e) => e.employeeNo)).size > 1)
    .map(([k]) => k);

  return {
    resolve(name: string) {
      const key = normalizePersonName(name);
      const matches = byNormalizedName.get(key);
      if (!matches || matches.length === 0) return null;
      const uniqueNos = [...new Set(matches.map((m) => m.employeeNo))];
      if (uniqueNos.length > 1) return null;
      return { employeeNo: matches[0].employeeNo, employeeName: matches[0].fullName };
    },
    stats() {
      return {
        rosterSize: [...byNormalizedName.values()].reduce((n, arr) => n + arr.length, 0),
        dbUsers,
        ambiguousNames,
      };
    },
  };
}
