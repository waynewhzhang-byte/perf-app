/**
 * 国网山西超高压变电公司能级评价量化积分表（暂行稿第一稿）维度定义。
 * 与 FormTemplate 的 section / item 结构对应，供事实数据归集与自动计分引用。
 *
 * 一级/二级维度权威注册表见 performance-dimension-registry.ts（源自《评分标准 对应表.xlsx》）。
 */

export type EvaluationDimensionCode =
  | 'basic.skill-level'
  | 'basic.title-level'
  | 'basic.performance-level'
  | 'performance.safety-contribution'
  | 'performance.technical-contribution'
  | 'performance.technical-contribution.textbook'
  | 'performance.technical-contribution.regulation'
  | 'performance.technical-contribution.ticket-revision'
  | 'performance.competition'
  | 'performance.competition.competition'
  | 'performance.competition.exam'
  | 'performance.innovation'
  | 'performance.innovation.award'
  | 'performance.innovation.paper-patent'
  | 'worksite.ticket-execution'
  | 'worksite.defect-governance'
  | 'special.violation-severe'
  | 'special.violation-general';

export interface EvaluationSubItem {
  code: EvaluationDimensionCode;
  title: string;
  maxScore: number;
  ownerDepartment: string;
  evidenceSource: string;
  scoringSummary: string;
}

export interface EvaluationSection {
  code: string;
  title: string;
  maxScore: number;
  items: EvaluationSubItem[];
}

/** 暂行稿第一稿完整维度树 */
export const EVALUATION_DIMENSIONS: EvaluationSection[] = [
  {
    code: 'basic',
    title: '基本素质',
    maxScore: 14,
    items: [
      {
        code: 'basic.skill-level',
        title: '技能等级',
        maxScore: 4,
        ownerDepartment: '组织部',
        evidenceSource: '人资2.0系统「我的信息-员工信息」',
        scoringSummary: '高级技师及以上4分；技师3分；高级工2分；其他1分',
      },
      {
        code: 'basic.title-level',
        title: '职称等级',
        maxScore: 4,
        ownerDepartment: '组织部',
        evidenceSource: '人资2.0系统「我的信息-员工信息」',
        scoringSummary: '高级工程师及以上4分；工程师3分；助理工程师2分',
      },
      {
        code: 'basic.performance-level',
        title: '绩效等级',
        maxScore: 6,
        ownerDepartment: '组织部',
        evidenceSource: '人资2.0系统「我的信息-员工信息」',
        scoringSummary: '三年3A得6分；2A1B得5.5分；1A2B得5分；3B得4.5分；其他4分',
      },
    ],
  },
  {
    code: 'performance',
    title: '工作业绩',
    maxScore: 44,
    items: [
      {
        code: 'performance.safety-contribution',
        title: '安全贡献',
        maxScore: 12,
        ownerDepartment: '安监部',
        evidenceSource: '安全工作奖惩实施细则、安全突出贡献签字审批单',
        scoringSummary: '第一发现人3分/次；其他发现人合计3分/次',
      },
      {
        code: 'performance.technical-contribution',
        title: '技术贡献',
        maxScore: 12,
        ownerDepartment: '组织部/安监部/运检部',
        evidenceSource: '教材编制/题库开发/课件开发、运规编写/会审、两票修订/审查记录',
        scoringSummary: '教材/题库/课件3分/次；运规/两票修订2分/项；总分封顶12',
      },
      {
        code: 'performance.competition',
        title: '竞赛比武',
        maxScore: 10,
        ownerDepartment: '组织部',
        evidenceSource: '获奖证书、获奖通报、公司荣誉册',
        scoringSummary: '代表省公司参加国网竞赛10分/次；代表公司参加省公司竞赛5分/次',
      },
      {
        code: 'performance.innovation',
        title: '发明创新',
        maxScore: 10,
        ownerDepartment: '各部门',
        evidenceSource: '管理创新/科技创新/QC/五小获奖材料、发明专利授权证书',
        scoringSummary: '管理/科技创新国网5省3；QC/五小国网4省2；发明专利4/3/2/1分',
      },
    ],
  },
  {
    code: 'worksite',
    title: '工作现场',
    maxScore: 42,
    items: [
      {
        code: 'worksite.ticket-execution',
        title: '两票执行',
        maxScore: 30,
        ownerDepartment: '安监部',
        evidenceSource: '各专业两票公示汇总（安监部审核）',
        scoringSummary: '操作票0.01分/项；工作负责人/许可人/班成员按票种计分，全年按比例折算',
      },
      {
        code: 'worksite.defect-governance',
        title: '缺陷治理',
        maxScore: 12,
        ownerDepartment: '运检部',
        evidenceSource: '运检部认定缺陷库缺陷（500kV变电站缺陷库消缺名单）',
        scoringSummary:
          '危急：第一发现/处理人各3分，共同发现/处理人各1分；严重：各1/0.5分；一般：第一发现/处理人各0.5分；同人兼发现与处理按高分计',
      },
    ],
  },
  {
    code: 'special',
    title: '特殊事项',
    maxScore: 0,
    items: [
      {
        code: 'special.violation-severe',
        title: '扣分项（严重违章）',
        maxScore: 0,
        ownerDepartment: '安监部',
        evidenceSource: '安监部通报',
        scoringSummary: '直接责任人扣10分/次；连带责任人扣5分/次',
      },
      {
        code: 'special.violation-general',
        title: '扣分项（一般违章）',
        maxScore: 0,
        ownerDepartment: '安监部',
        evidenceSource: '安监部通报',
        scoringSummary: '直接责任人扣5分/次；连带责任人扣2.5分/次',
      },
    ],
  },
];

/** 500kV 缺陷库消缺名单对应的具体评价子项 */
export const DEFECT_LIBRARY_DIMENSION: EvaluationSubItem =
  EVALUATION_DIMENSIONS.find((s) => s.code === 'worksite')!.items.find(
    (i) => i.code === 'worksite.defect-governance',
  )!;

/** 两票公示汇总对应的具体评价子项 */
export const TICKET_EXECUTION_DIMENSION: EvaluationSubItem =
  EVALUATION_DIMENSIONS.find((s) => s.code === 'worksite')!.items.find(
    (i) => i.code === 'worksite.ticket-execution',
  )!;

/** 安全突出贡献奖明细对应的具体评价子项 */
export const SAFETY_CONTRIBUTION_DIMENSION: EvaluationSubItem =
  EVALUATION_DIMENSIONS.find((s) => s.code === 'performance')!.items.find(
    (i) => i.code === 'performance.safety-contribution',
  )!;

export function findDimensionByCode(
  code: EvaluationDimensionCode,
): EvaluationSubItem | undefined {
  for (const section of EVALUATION_DIMENSIONS) {
    const item = section.items.find((i) => i.code === code);
    if (item) return item;
  }
  return undefined;
}
