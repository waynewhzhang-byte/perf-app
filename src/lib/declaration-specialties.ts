/**
 * 能级评价申报专业（员工个人选择）。
 * 与组织字典 DeclarationSpecialty 种子/同步脚本保持一致。
 */
export const DECLARATION_SPECIALTY_NAMES = [
  '直流运检',
  '变电检修',
  '变电运维',
  '继电保护',
  '电气试验（含油务）',
  '通信自动化',
  '站内交直流',
] as const;

export type DeclarationSpecialtyName = (typeof DECLARATION_SPECIALTY_NAMES)[number];
