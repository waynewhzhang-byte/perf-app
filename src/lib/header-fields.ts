// 模板表头字段配置 — type, defaults, labels, and resolver shared by client and server

export type HeaderFieldKey = 'workArea' | 'hireDate' | 'declarationLevel' | 'declarationSpecialty';

export interface HeaderFieldConfig {
  key: HeaderFieldKey;
  enabled: boolean;
  required: boolean;
}

/** 默认：全部启用且必填（向后兼容未配置 headerFields 的旧模板） */
export const DEFAULT_HEADER_FIELDS: HeaderFieldConfig[] = [
  { key: 'workArea', enabled: true, required: true },
  { key: 'hireDate', enabled: true, required: true },
  { key: 'declarationLevel', enabled: true, required: true },
  { key: 'declarationSpecialty', enabled: true, required: true },
];

export const HEADER_FIELD_LABELS: Record<HeaderFieldKey, string> = {
  workArea: '工区',
  hireDate: '入职时间',
  declarationLevel: '能级评价等级',
  declarationSpecialty: '能级评价专业',
};

/**
 * 将 Prisma JSON 原始值解析为有效的 HeaderFieldConfig 数组。
 * - 空 / null / undefined / 非数组 → 返回全部启用的默认值（向后兼容）
 * - 元素形状非法 → 同样回退到默认值（防御性）
 */
export function resolveHeaderFields(raw: unknown): HeaderFieldConfig[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const valid = raw.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).key === 'string' &&
        typeof (item as Record<string, unknown>).enabled === 'boolean' &&
        typeof (item as Record<string, unknown>).required === 'boolean',
    );
    if (valid) return raw as HeaderFieldConfig[];
  }
  return DEFAULT_HEADER_FIELDS;
}

/**
 * 从已解析的 headerField 配置中查找某个字段的 enabled 状态。
 * 回调：字段未出现在配置中 → 默认启用（保守）
 */
export function isFieldEnabled(fields: HeaderFieldConfig[], key: HeaderFieldKey): boolean {
  const cfg = fields.find((f) => f.key === key);
  return cfg ? cfg.enabled : true;
}

/**
 * 从已解析的 headerField 配置中查找某个字段的 required 状态。
 * 回调：字段未出现在配置中 → 默认必填（保守）
 */
export function isFieldRequired(fields: HeaderFieldConfig[], key: HeaderFieldKey): boolean {
  const cfg = fields.find((f) => f.key === key);
  return cfg ? cfg.enabled && cfg.required : true;
}
