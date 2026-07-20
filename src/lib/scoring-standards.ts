/**
 * 《2025年能级评价量化积分表》评分标准（源自 评分标准 对应表.xlsx）
 *
 * 规则说明：
 * - dataSource=fact：有导入事实时按 ruleType 自动计分；无事实则得 0（员工不手工填）
 * - dataSource=manual：无导入数据，由员工在申报表选择档次/次数计分
 * - dataSource=deduction：扣分项，从总分扣减
 */
import type { EvaluationDimensionCode } from '@/lib/evaluation-dimensions';

export type ScoringDataSource = 'fact' | 'manual' | 'deduction';

export type StandardRuleType =
  | 'BASIC_TIER'      // 基本素质：档位映射（导入时已算分）
  | 'MATRIX_SUM'      // 缺陷治理：事实累加 + 封顶
  | 'NORMALIZE'       // 两票：原始分 ÷ 能级内最高 × 满分
  | 'SHARE'           // 安全贡献：按事件均分
  | 'MANUAL_TIERS'    // 表单档次单选/多选
  | 'MANUAL_COUNTED'  // 表单按次计分
  | 'DEDUCTION';      // 扣分

export interface DimensionScoringStandard {
  code: EvaluationDimensionCode;
  title: string;
  sectionCode: 'basic' | 'performance' | 'worksite' | 'special';
  sectionTitle: string;
  maxScore: number;
  dataSource: ScoringDataSource;
  ruleType: StandardRuleType;
  /** 对应 ScoringRule.ruleType（事实维度写入 DB 的规则） */
  engineRuleType?: 'MATRIX' | 'SHARE' | 'NORMALIZE' | 'BASIC_TIER';
  ownerDepartment: string;
  scoringSummary: string;
  referenceFile?: string;
  notes?: string;
}

/** 完整评分标准表（与《2026年能级评价量化积分表》完全对齐） */
export const SCORING_STANDARDS: DimensionScoringStandard[] = [
  // ── 1. 基本素质 14 ──
  {
    code: 'basic.skill-level', title: '技能等级',
    sectionCode: 'basic', sectionTitle: '基本素质', maxScore: 4,
    dataSource: 'fact', ruleType: 'BASIC_TIER',
    ownerDepartment: '组织部',
    scoringSummary: '高级技师及以上4；技师3；高级工2；其他1',
    referenceFile: '1.能级评价员工花名册.xlsx',
  },
  {
    code: 'basic.title-level', title: '职称等级',
    sectionCode: 'basic', sectionTitle: '基本素质', maxScore: 4,
    dataSource: 'fact', ruleType: 'BASIC_TIER',
    ownerDepartment: '组织部',
    scoringSummary: '高级工程师及以上4；工程师3；助理工程师2',
    referenceFile: '1.能级评价员工花名册.xlsx',
  },
  {
    code: 'basic.performance-level', title: '绩效等级',
    sectionCode: 'basic', sectionTitle: '基本素质', maxScore: 6,
    dataSource: 'fact', ruleType: 'BASIC_TIER',
    ownerDepartment: '组织部',
    scoringSummary: '3A→6；2A1B→5.5；1A2B→5；3B→4.5；含C或其他→4',
    referenceFile: '2.人员考核结果.xlsx',
  },
  // ── 2. 工作业绩 44 ──
  {
    code: 'performance.safety-contribution', title: '安全贡献',
    sectionCode: 'performance', sectionTitle: '工作业绩', maxScore: 12,
    dataSource: 'fact', ruleType: 'SHARE', engineRuleType: 'SHARE',
    ownerDepartment: '安监部',
    scoringSummary: '第一发现人3分/次；其他发现人合计3分/次均分',
    referenceFile: '3.突出贡献奖人员汇总.xlsx',
  },
  {
    code: 'performance.technical-contribution', title: '技术贡献',
    sectionCode: 'performance', sectionTitle: '工作业绩', maxScore: 12,
    dataSource: 'fact', ruleType: 'MANUAL_COUNTED',
    ownerDepartment: '组织部/安监部/运检部',
    scoringSummary: '教材/题库/课件3分/次；运规/两票修订2分/项；封顶12',
    referenceFile: '4-6.技术贡献三文件.xlsx',
  },
  {
    code: 'performance.competition', title: '竞赛比武',
    sectionCode: 'performance', sectionTitle: '工作业绩', maxScore: 10,
    dataSource: 'fact', ruleType: 'MANUAL_TIERS',
    ownerDepartment: '组织部',
    scoringSummary: '国网竞赛10分/次；省公司竞赛5分/次',
    referenceFile: '7.竞赛比武.xlsx',
  },
  {
    code: 'performance.innovation', title: '发明创新',
    sectionCode: 'performance', sectionTitle: '工作业绩', maxScore: 10,
    dataSource: 'fact', ruleType: 'MANUAL_TIERS',
    ownerDepartment: '各部门',
    scoringSummary: '管理/科技创新国网5省3；QC/五小国网4省2；发明专利4/3/2/1',
    referenceFile: '8-9.创新奖项+发明专利.xlsx',
  },
  // ── 3. 工作现场 42 ──
  {
    code: 'worksite.ticket-execution', title: '两票执行',
    sectionCode: 'worksite', sectionTitle: '工作现场', maxScore: 30,
    dataSource: 'fact', ruleType: 'NORMALIZE', engineRuleType: 'NORMALIZE',
    ownerDepartment: '安监部',
    scoringSummary: '操作票0.01分/项；工作票按负责人/许可人/班成员计分；按能级归一化',
    referenceFile: '10-13.两票数据汇总.xlsx',
  },
  {
    code: 'worksite.defect-governance', title: '缺陷治理',
    sectionCode: 'worksite', sectionTitle: '工作现场', maxScore: 12,
    dataSource: 'fact', ruleType: 'MATRIX_SUM', engineRuleType: 'MATRIX',
    ownerDepartment: '运检部',
    scoringSummary: '危急3/1；严重1/0.5；一般0.5；同人兼发现处理取高；封顶12',
    referenceFile: '14.问题清单数据2025年.xlsx',
    notes: '不可与安全贡献重复加分',
  },
  // ── 4. 特殊事项 ──
  {
    code: 'special.violation-severe', title: '严重违章扣分',
    sectionCode: 'special', sectionTitle: '特殊事项', maxScore: 0,
    dataSource: 'deduction', ruleType: 'DEDUCTION',
    ownerDepartment: '安监部',
    scoringSummary: '直接责任人-10/次；连带-5/次',
  },
  {
    code: 'special.violation-general', title: '一般违章扣分',
    sectionCode: 'special', sectionTitle: '特殊事项', maxScore: 0,
    dataSource: 'deduction', ruleType: 'DEDUCTION',
    ownerDepartment: '安监部',
    scoringSummary: '直接责任人-5/次；连带-2.5/次',
  },
];

export const SCORING_STANDARD_BY_CODE = Object.fromEntries(
  SCORING_STANDARDS.map((s) => [s.code, s]),
) as Record<string, DimensionScoringStandard>;

export function getScoringStandard(code: string): DimensionScoringStandard | undefined {
  return SCORING_STANDARD_BY_CODE[code];
}

/**
 * 模板二级项与导入事实的对应关系。技术、竞赛、创新在原始台账中按更细的
 * 事实类型存储，但员工表单只展示 Excel 定义的二级评分项，因此读取时必须聚合。
 */
export function sourceDimensionCodes(code: string): string[] {
  switch (code) {
    case 'performance.technical-contribution':
      return [
        'performance.technical-contribution.textbook',
        'performance.technical-contribution.regulation',
        'performance.technical-contribution.ticket-revision',
      ];
    case 'performance.competition':
      return ['performance.competition.competition', 'performance.competition.exam'];
    case 'performance.innovation':
      return ['performance.innovation.award', 'performance.innovation.paper-patent'];
    default:
      return [code];
  }
}

/** 申报项标题 → dimensionCode（模板未绑 dimensionCode 时的兜底） */
export const TITLE_DIMENSION_HINTS: { pattern: RegExp; code: EvaluationDimensionCode }[] = [
  { pattern: /技能等级/, code: 'basic.skill-level' },
  { pattern: /职称等级/, code: 'basic.title-level' },
  { pattern: /绩效等级/, code: 'basic.performance-level' },
  { pattern: /安全贡献/, code: 'performance.safety-contribution' },
  { pattern: /教材|题库|课件/, code: 'performance.technical-contribution.textbook' },
  { pattern: /运规|规程编写|规程会审/, code: 'performance.technical-contribution.regulation' },
  { pattern: /两票.*修订|两票.*审查/, code: 'performance.technical-contribution.ticket-revision' },
  { pattern: /技术贡献/, code: 'performance.technical-contribution.textbook' }, // fallback
  { pattern: /竞赛比武|竞赛/, code: 'performance.competition.competition' },
  { pattern: /调考/, code: 'performance.competition.exam' },
  { pattern: /发明创新|创新/, code: 'performance.innovation.award' },
  { pattern: /论文|专利/, code: 'performance.innovation.paper-patent' },
  { pattern: /两票/, code: 'worksite.ticket-execution' },
  { pattern: /缺陷/, code: 'worksite.defect-governance' },
  { pattern: /严重违章/, code: 'special.violation-severe' },
  { pattern: /一般违章/, code: 'special.violation-general' },
  { pattern: /违章/, code: 'special.violation-general' },
];

export function inferDimensionCodeFromTitle(title: string): EvaluationDimensionCode | null {
  for (const { pattern, code } of TITLE_DIMENSION_HINTS) {
    if (pattern.test(title)) return code;
  }
  return null;
}

/** 默认 ScoringRule DB 配置（与《2025年能级评价量化积分表》一致，共 6 条系统导入维度规则） */
export function defaultScoringRuleConfigs(): Array<{
  dimensionCode: string;
  dimensionName: string;
  ruleType: 'BASIC_TIER' | 'MATRIX' | 'SHARE' | 'NORMALIZE';
  cap: number;
  config: Record<string, unknown>;
}> {
  return [
    // ── 1. 基本素质（14）—— BASIC_TIER 档位映射 ──
    {
      dimensionCode: 'basic.skill-level',
      dimensionName: '技能等级',
      ruleType: 'BASIC_TIER',
      cap: 4,
      config: { tiers: { 高级技师: 4, 技师: 3, 高级工: 2, 中级工: 1 }, defaultScore: 1 },
    },
    {
      dimensionCode: 'basic.title-level',
      dimensionName: '职称等级',
      ruleType: 'BASIC_TIER',
      cap: 4,
      config: { tiers: { 正高级: 4, 副高级: 4, 中级: 3, 初级: 2 }, defaultScore: 0 },
    },
    {
      dimensionCode: 'basic.performance-level',
      dimensionName: '绩效等级',
      ruleType: 'BASIC_TIER',
      cap: 6,
      config: { tiers: { '3A': 6, '2A1B': 5.5, '1A2B': 5, '3B': 4.5 }, defaultScore: 4 },
    },
    // ── 2. 工作业绩 — 安全贡献（SHARE 均分）──
    {
      dimensionCode: 'performance.safety-contribution',
      dimensionName: '安全贡献',
      ruleType: 'SHARE',
      cap: 12,
      config: {
        roles: {
          FIRST_DISCOVERER: { perIncident: 3, multiplyByFaultCount: true },
          CO_DISCOVERER: { totalShare: 3, multiplyByFaultCount: true, splitAmong: 'CO_DISCOVERER' },
        },
        groupBy: 'incidentId',
      },
    },
    // ── 技术贡献 — COUNTED（按人次计数 × 单次分值）──
    {
      dimensionCode: 'performance.technical-contribution.textbook',
      dimensionName: '技术贡献（教材/题库/课件）',
      ruleType: 'BASIC_TIER',
      cap: 12,
      config: { tiers: {}, defaultScore: 3, countMode: true },
    },
    {
      dimensionCode: 'performance.technical-contribution.regulation',
      dimensionName: '技术贡献（运规编写/会审）',
      ruleType: 'BASIC_TIER',
      cap: 12,
      config: { tiers: {}, defaultScore: 2, countMode: true },
    },
    {
      dimensionCode: 'performance.technical-contribution.ticket-revision',
      dimensionName: '技术贡献（两票修订/审查）',
      ruleType: 'BASIC_TIER',
      cap: 12,
      config: { tiers: {}, defaultScore: 2, countMode: true },
    },
    // ── 3. 工作现场（42）──
    {
      dimensionCode: 'worksite.defect-governance',
      dimensionName: '缺陷治理',
      ruleType: 'MATRIX',
      cap: 12,
      config: {
        matrix: {
          危急: { FIRST_DISCOVERER: 3, CO_DISCOVERER: 1, FIRST_HANDLER: 3, CO_HANDLER: 1 },
          严重: { FIRST_DISCOVERER: 1, CO_DISCOVERER: 0.5, FIRST_HANDLER: 1, CO_HANDLER: 0.5 },
          一般: { FIRST_DISCOVERER: 0.5, FIRST_HANDLER: 0.5 },
        },
        tieBreak: 'MAX_PER_PERSON',
      },
    },
    {
      dimensionCode: 'worksite.ticket-execution',
      dimensionName: '两票执行',
      ruleType: 'NORMALIZE',
      cap: 30,
      config: {
        operationStepPrice: 0.01,
        ticketPrices: {
          workLeader: { 总工作票: 5, 分工作票: 3, 单班组一种票: 3, 二种票: 1 },
          workPermitter: { 总工作票: 1.5, 单班组一种票: 1, 二种票: 0.3 },
          workMember: { 单班组一种票: 1.5, 二种票: 0.5 },
        },
        targetMaxScore: 30,
        sourceKey: 'rawScore',
        normalizeWithin: 'declarationLevel',
      },
    },
  ];
}
