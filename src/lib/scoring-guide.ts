/**
 * 员工端评分规则说明页的数据组装。
 * 单一数据源：SCORING_STANDARDS + declaration-level 常量；
 * 文案可被管理员按年度覆盖（overrides，纯展示，不影响分数）。
 */
import { DECLARATION_LEVELS } from './declaration-level';
import {
  SCORING_STANDARDS,
  applyDisplayOverrides,
  type DimensionScoringStandard,
  type ScoringStandardDisplayOverride,
  type StandardRuleType,
} from './scoring-standards';

export interface ScoringGuideSection {
  code: string;
  title: string;
  maxScore: number;
  items: DimensionScoringStandard[];
}

export interface DeclarationLevelRule {
  level: (typeof DECLARATION_LEVELS)[number];
  workYears: string;
}

export interface RuleTypeExplanation {
  ruleType: StandardRuleType;
  label: string;
  description: string;
}

export interface ScoringGuideContent {
  year: number;
  positiveMaxScore: number;
  sections: ScoringGuideSection[];
  deductionItems: DimensionScoringStandard[];
  declarationLevels: DeclarationLevelRule[];
  evaluationCutoffNote: string;
  dataFlowSteps: string[];
  ruleTypeExplanations: RuleTypeExplanation[];
  ticketNormalizeExample: string;
}

const SECTION_ORDER = ['basic', 'performance', 'worksite'] as const;

const RULE_TYPE_LABELS: Record<StandardRuleType, string> = {
  BASIC_TIER: '档位映射',
  MATRIX_SUM: '矩阵计分',
  NORMALIZE: '能级归一化',
  SHARE: '事件均分',
  MANUAL_TIERS: '档次计分',
  MANUAL_COUNTED: '按次计分',
  DEDUCTION: '扣分累加',
};

const RULE_TYPE_EXPLANATIONS: RuleTypeExplanation[] = [
  {
    ruleType: 'BASIC_TIER',
    label: RULE_TYPE_LABELS.BASIC_TIER,
    description: '根据导入台账中的档位（如技能等级、职称、近三年绩效组合）查表得分，不按次数累加。',
  },
  {
    ruleType: 'SHARE',
    label: RULE_TYPE_LABELS.SHARE,
    description: '按安全事件分组，第一发现人与共同发现人按规则分配分值；多人共同发现时均分。',
  },
  {
    ruleType: 'MANUAL_COUNTED',
    label: RULE_TYPE_LABELS.MANUAL_COUNTED,
    description: '按导入事实的次数 × 单次分值累加，达到该维度满分后封顶。',
  },
  {
    ruleType: 'MANUAL_TIERS',
    label: RULE_TYPE_LABELS.MANUAL_TIERS,
    description: '按竞赛级别、创新类别等档次查表得分，同一维度内累加后封顶。',
  },
  {
    ruleType: 'MATRIX_SUM',
    label: RULE_TYPE_LABELS.MATRIX_SUM,
    description: '按「缺陷等级 × 角色」查矩阵表计分；同一人对同一缺陷兼发现与处理时取高分，维度总分封顶。',
  },
  {
    ruleType: 'NORMALIZE',
    label: RULE_TYPE_LABELS.NORMALIZE,
    description: '先按票种与角色计算原始分，再在同能级、同专业内按最高原始分折算到满分 30。',
  },
  {
    ruleType: 'DEDUCTION',
    label: RULE_TYPE_LABELS.DEDUCTION,
    description: '违章事实按责任类型扣分，从正向积分合计中扣减，无封顶。',
  },
];

export function ruleTypeLabel(ruleType: StandardRuleType): string {
  return RULE_TYPE_LABELS[ruleType] ?? ruleType;
}

export function buildScoringGuideContent(
  year = 2026,
  overrides?: Map<string, ScoringStandardDisplayOverride>,
): ScoringGuideContent {
  // 应用文案覆盖（纯显示，maxScore/ruleType 等结构字段不受影响）
  const standards = overrides ? applyDisplayOverrides(SCORING_STANDARDS, overrides) : SCORING_STANDARDS;
  const positiveItems = standards.filter((s) => s.dataSource !== 'deduction');
  const deductionItems = standards.filter((s) => s.dataSource === 'deduction');
  const positiveMaxScore = positiveItems.reduce((sum, item) => sum + item.maxScore, 0);

  const sections: ScoringGuideSection[] = SECTION_ORDER.map((code) => {
    const items = positiveItems.filter((item) => item.sectionCode === code);
    return {
      code,
      title: items[0]?.sectionTitle ?? code,
      maxScore: items.reduce((sum, item) => sum + item.maxScore, 0),
      items,
    };
  });

  return {
    year,
    positiveMaxScore,
    sections,
    deductionItems,
    declarationLevels: [
      { level: '三级', workYears: '0 ≤ 工龄 < 5 年' },
      { level: '二级', workYears: '5 ≤ 工龄 < 9 年' },
      { level: '一级', workYears: '工龄 ≥ 9 年' },
    ],
    evaluationCutoffNote: `${year} 年度评价统一按 ${year} 年 7 月 31 日计算工龄与参评能级。能级主要影响「两票执行」的折算基准。`,
    dataFlowSteps: [
      '各部门按职责导入 Excel 台账（花名册、考核结果、缺陷库、两票数据等）',
      '系统按《评分标准 对应表》自动匹配事实并计分',
      '您在申报页查看每项得分、事实记录与积分过程',
      '逐项「确认」或「申诉」；申诉需说明理由并上传证明材料',
      '审核通过后计入年度绩效档案',
    ],
    ruleTypeExplanations: RULE_TYPE_EXPLANATIONS,
    ticketNormalizeExample:
      '示例：某员工（一级能级）两票原始分 18.5，同专业最高原始分 20.0 → 18.5 ÷ 20.0 × 30 = 27.8 分',
  };
}
