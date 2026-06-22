export interface ImportFieldSpec {
  key: string;
  label: string;
  headerAliases?: string[];
}

/**
 * 将 Excel/CSV 表头自动映射到导入字段。
 * 优先精确匹配 label 与 headerAliases；避免「技能等级」误匹配「技能等级工种」。
 */
export function resolveHeaderMapping(
  headers: string[],
  fields: ImportFieldSpec[],
): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};

  for (const field of fields) {
    const candidates = [field.label, ...(field.headerAliases ?? [])];
    let match: string | undefined;

    for (const candidate of candidates) {
      const hit = headers.find((h) => h === candidate && !used.has(h));
      if (hit) {
        match = hit;
        break;
      }
    }

    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }

  return mapping;
}
