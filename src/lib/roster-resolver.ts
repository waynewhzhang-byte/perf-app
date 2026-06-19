/**
 * 以基本素质名册（User 表 employeeNo + fullName）为唯一匹配源。
 */
import { normalizePersonName } from '@/lib/employee-resolver';

export interface RosterUser {
  employeeNo: string;
  fullName: string;
}

export interface RosterResolver {
  resolve(name: string): { employeeNo: string; employeeName: string } | null;
  /** 名册中重名（同归一化姓名对应多个工号） */
  ambiguousNameKeys: Set<string>;
  rosterNameKeys: Set<string>;
}

export function createRosterResolverFromUsers(users: RosterUser[]): RosterResolver {
  const byNormalizedName = new Map<string, RosterUser[]>();

  for (const u of users) {
    if (!u.employeeNo || !u.fullName) continue;
    const key = normalizePersonName(u.fullName);
    const list = byNormalizedName.get(key) ?? [];
    list.push(u);
    byNormalizedName.set(key, list);
  }

  const ambiguousNameKeys = new Set<string>();
  for (const [key, list] of byNormalizedName) {
    const uniqueNos = new Set(list.map((x) => x.employeeNo));
    if (uniqueNos.size > 1) ambiguousNameKeys.add(key);
  }

  return {
    ambiguousNameKeys,
    rosterNameKeys: new Set(byNormalizedName.keys()),
    resolve(name: string) {
      const key = normalizePersonName(name);
      const matches = byNormalizedName.get(key);
      if (!matches || matches.length === 0) return null;
      const uniqueNos = new Set(matches.map((m) => m.employeeNo));
      if (uniqueNos.size > 1) return null;
      return { employeeNo: matches[0].employeeNo, employeeName: matches[0].fullName };
    },
  };
}

export type UnmatchedReason = 'DUPLICATE_IN_ROSTER' | 'NOT_IN_ROSTER';

export interface ClassifiedUnmatched {
  name: string;
  normalizedName: string;
  reason: UnmatchedReason;
  /** 重名时的候选工号 */
  candidateEmployeeNos?: string[];
  source: 'tickets' | 'defects' | 'safety';
  occurrences?: number;
}

/** 将未匹配姓名分类；管理员仅关注「在基本素质名册中」的项 */
export function classifyUnmatchedNames(
  entries: { name: string; source: 'tickets' | 'defects' | 'safety'; occurrences?: number }[],
  resolver: RosterResolver,
  users: RosterUser[],
): { inRoster: ClassifiedUnmatched[]; external: ClassifiedUnmatched[] } {
  const byKey = new Map<string, RosterUser[]>();
  for (const u of users) {
    if (!u.employeeNo) continue;
    const key = normalizePersonName(u.fullName);
    const list = byKey.get(key) ?? [];
    list.push(u);
    byKey.set(key, list);
  }

  const inRoster: ClassifiedUnmatched[] = [];
  const external: ClassifiedUnmatched[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const normalizedName = normalizePersonName(entry.name);
    const dedupeKey = `${entry.source}\0${normalizedName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const inRosterList = byKey.get(normalizedName);
    if (!inRosterList || inRosterList.length === 0) {
      external.push({
        name: entry.name,
        normalizedName,
        reason: 'NOT_IN_ROSTER',
        source: entry.source,
        occurrences: entry.occurrences,
      });
      continue;
    }

    // 在名册中：重名或本应能匹配却出现在未匹配列表
    if (resolver.ambiguousNameKeys.has(normalizedName) || inRosterList.length > 1) {
      inRoster.push({
        name: entry.name,
        normalizedName,
        reason: 'DUPLICATE_IN_ROSTER',
        candidateEmployeeNos: [...new Set(inRosterList.map((u) => u.employeeNo))],
        source: entry.source,
        occurrences: entry.occurrences,
      });
    } else if (!resolver.resolve(entry.name)) {
      inRoster.push({
        name: entry.name,
        normalizedName,
        reason: 'DUPLICATE_IN_ROSTER',
        candidateEmployeeNos: [inRosterList[0].employeeNo],
        source: entry.source,
        occurrences: entry.occurrences,
      });
    }
  }

  return {
    inRoster: inRoster.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    external: external.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  };
}

/** 仅保留需在名册内处理的未匹配（重名等） */
export function filterUnmatchedInRosterOnly(classified: ClassifiedUnmatched[]): ClassifiedUnmatched[] {
  return classified.filter((c) => c.reason === 'DUPLICATE_IN_ROSTER');
}
