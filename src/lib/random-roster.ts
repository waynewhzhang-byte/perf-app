import { createHash } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { normalizePersonName } from '@/lib/employee-resolver';
import { parsePersonList } from '@/lib/defect-governance';

export interface GeneratedRosterEntry {
  employeeNo: string;
  fullName: string;
}

/** 从姓名稳定生成测试用工号（可复现） */
export function generateEmployeeNo(fullName: string, index: number, prefix = 'SX-RND'): string {
  const hash = createHash('sha1').update(fullName).digest('hex').slice(0, 4).toUpperCase();
  return `${prefix}-${String(index).padStart(4, '0')}-${hash}`;
}

export function collectPersonNamesFromDefectRows(
  rows: Record<string, string | number | null | undefined>[],
): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    for (const field of ['发现人', '消缺人']) {
      for (const name of parsePersonList(row[field])) {
        const key = normalizePersonName(name);
        if (key && !seen.has(key)) {
          seen.set(key, name.replace(/[·•]/g, '').trim());
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function buildRandomRoster(
  names: string[],
  options?: { prefix?: string; startIndex?: number },
): GeneratedRosterEntry[] {
  const prefix = options?.prefix ?? 'SX-RND';
  const start = options?.startIndex ?? 1;
  return names.map((fullName, i) => ({
    employeeNo: generateEmployeeNo(fullName, start + i, prefix),
    fullName,
  }));
}

export function writeRosterCsv(entries: GeneratedRosterEntry[], filePath: string): void {
  const lines = ['工号,姓名', ...entries.map((e) => `${e.employeeNo},${e.fullName}`)];
  mkdirSync(filePath.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

export function createRosterResolver(entries: GeneratedRosterEntry[]) {
  const byName = new Map<string, GeneratedRosterEntry>();
  for (const e of entries) {
    byName.set(normalizePersonName(e.fullName), e);
  }
  return {
    resolve(name: string): { employeeNo: string; employeeName: string } | null {
      const hit = byName.get(normalizePersonName(name));
      if (!hit) return null;
      return { employeeNo: hit.employeeNo, employeeName: hit.fullName };
    },
  };
}

/** 由工号/姓名生成稳定的测试用个人信息 */
export function fakePersonalInfo(employeeNo: string, fullName: string) {
  const seed = createHash('sha1').update(employeeNo + fullName).digest();
  const n = seed[0] + seed[1] * 256;
  const gender = n % 5 === 0 ? '女' : '男';
  const workYears = 5 + (n % 26);
  const positions = ['班员', '技术员', '副班长', '班长', '七级职员'] as const;
  const position = positions[n % positions.length];
  const specialties = ['变电检修', '其他（站内交直流、通信等小专业）'] as const;
  const specialty = specialties[n % specialties.length];
  return { gender, workYears: String(workYears), position, specialty };
}
