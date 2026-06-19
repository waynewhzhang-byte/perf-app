/**
 * 基本素质评分（满分 14 分）
 *
 * 三条维度，与 evaluation-dimensions.ts 的 basic.* 维度代码一一对应：
 *   - 技能等级（4 分）：高级技师及以上 4 / 技师 3 / 高级工 2 / 其他 1
 *   - 职称等级（4 分）：高级工程师及以上 4 / 工程师 3 / 助理工程师 2
 *   - 绩效等级（6 分）：三年滚动 3A→6 / 2A1B→5.5 / 1A2B→5 / 3B→4.5 / 其他 4
 *
 * 数据来源：《基本素质信息》.xlsx
 *   - Sheet1「技能等级 职称」：技能等级列、专业技术资格等级列
 *   - Sheet2「考核结果」：2023/2024/2025 年考核等级（A/B/C）
 *
 * 评分依据：《国网山西超高压变电公司能级评价量化积分表（暂行稿第一稿）》
 */

/** 基本素质维度代码（与 EvaluationDimensionCode 的 basic.* 段对齐） */
export const BASIC_DIMENSION_CODES = {
  SKILL_LEVEL: 'basic.skill-level',
  TITLE_LEVEL: 'basic.title-level',
  PERFORMANCE_LEVEL: 'basic.performance-level',
} as const;

// ── 技能等级 ─────────────────────────────────────────────────────
// 数据来源 Sheet1 第 10 列「技能等级」。档位映射来自 ScoringRule.config.tiers
//   默认（与《2025量化积分表》一致）：高级技师=4 / 技师=3 / 高级工=2 / 中级工=1
/** 默认技能等级档位表（DB 无配置时回退） */
export const DEFAULT_SKILL_TIERS: Record<string, number> = {
  高级技师: 4,
  技师: 3,
  高级工: 2,
  中级工: 1,
};

/** 技能等级档位 → 得分；tiers 默认 DB 种子，defaultScore 默认 1（未知/空值归「其他」） */
export function scoreSkillLevel(
  raw: string | null | undefined,
  tiers: Record<string, number> = DEFAULT_SKILL_TIERS,
  defaultScore = 1,
): number {
  if (!raw) return defaultScore;
  const v = raw.trim();
  return Object.prototype.hasOwnProperty.call(tiers, v) ? tiers[v] : defaultScore;
}

// ── 职称等级 ─────────────────────────────────────────────────────
// 数据来源 Sheet1 第 12 列「专业技术资格等级」。档位映射来自 ScoringRule.config.tiers
//   默认：正高级=4 / 副高级=4 / 中级=3 / 初级=2
/** 默认职称档位表（DB 无配置时回退） */
export const DEFAULT_TITLE_TIERS: Record<string, number> = {
  正高级: 4,
  副高级: 4,
  中级: 3,
  初级: 2,
};

/** 职称等级档位 → 得分；空值=0（无职称不计分） */
export function scoreTitleLevel(
  raw: string | null | undefined,
  tiers: Record<string, number> = DEFAULT_TITLE_TIERS,
  defaultScore = 0,
): number {
  if (!raw) return defaultScore;
  const v = raw.trim();
  return Object.prototype.hasOwnProperty.call(tiers, v) ? tiers[v] : defaultScore;
}

// ── 绩效等级（三年滚动）─────────────────────────────────────────
// 数据来源 Sheet2「考核结果」三年 A/B/C。暂行稿组合映射：
//   3A→6 / 2A1B→5.5 / 1A2B→5 / 3B→4.5 / 其他（满足基本绩效要求）→4
// 注：C 及缺失不属于 A/B 组合，归入「其他」=4。

/** 默认绩效组合档位表（组合码 → 得分；DB 无配置时回退） */
export const DEFAULT_PERFORMANCE_TIERS: Record<string, number> = {
  '3A': 6,
  '2A1B': 5.5,
  '1A2B': 5,
  '3B': 4.5,
  其他: 4,
};

export interface PerformanceCombo {
  /** 组合码，如 "3A"、"2A1B"、"1A2B"、"3B"、"其他"；缺失记 "其他" */
  code: string;
  /** 得分 */
  score: number;
  /** 三年明细是否齐全（无缺失） */
  complete: boolean;
}

/**
 * 由三年考核等级数组计算绩效组合分。组合码由 A/B 计数派生，得分查 tiers 表。
 *
 * @param grades 三年等级，按时间顺序，如 ['A','B','B']；缺失/空/C 记为 null
 * @param tiers  组合码 → 得分（默认 DB 种子）
 * @returns 组合码 + 得分 + 完整性
 */
export function scorePerformanceLevel(
  grades: Array<string | null | undefined>,
  tiers: Record<string, number> = DEFAULT_PERFORMANCE_TIERS,
): PerformanceCombo {
  // 过滤出有效 A/B（C、缺失、其他字母一律视作「非 A/B」）
  const ab = grades.map((g) => (g ? g.trim().toUpperCase() : '')).filter((g) => g === 'A' || g === 'B');
  const complete = grades.every((g) => {
    const v = g ? g.trim().toUpperCase() : '';
    return v === 'A' || v === 'B' || v === 'C'; // C 算参与考核，但非 A/B
  });
  const a = ab.filter((g) => g === 'A').length;
  const b = ab.filter((g) => g === 'B').length;

  // 仅当三年均为 A/B 且数量合计为 3 时套用暂行稿组合
  let code: string;
  if (a + b === 3) {
    if (a === 3) code = '3A';
    else if (a === 2 && b === 1) code = '2A1B';
    else if (a === 1 && b === 2) code = '1A2B';
    else if (b === 3) code = '3B';
    else code = '其他';
  } else {
    code = '其他';
  }

  const score = Object.prototype.hasOwnProperty.call(tiers, code) ? tiers[code] : (tiers['其他'] ?? 4);
  return { code, score, complete };
}

// ── Sheet 列映射 ─────────────────────────────────────────────────

/** Sheet1「技能等级 职称」列索引（0 基） */
export const SHEET1_COLUMNS = {
  employeeNo: 0, // 人员编号
  name: 1, // 姓名
  department: 2, // 部门
  team: 3, // 班组/处室
  position: 4, // 岗位
  positionCode: 5, // 岗位分类代码
  positionCategory: 6, // 岗位分类
  workLeaderFlag: 7, // 工作负责人标识
  gender: 8, // 性别
  skillJobType: 9, // 技能等级工种
  skillLevel: 10, // 技能等级
  titleSeries: 11, // 专业技术资格系列
  titleLevel: 12, // 专业技术资格等级
} as const;

/** Sheet2「考核结果」列索引（真实表头在第 2 行，1 基）；以下为 0 基、相对真实表头 */
export const SHEET2_COLUMNS = {
  seq: 0, // 序号
  employeeNo: 1, // 人员编码
  name: 2, // 人员姓名
  unit: 3, // 所属单位
  position: 4, // 岗位
  personnelType: 5, // 人员类型
  assessed: 6, // 是否考核
  year2023: 7, // 2023年考核等级
  year2024: 8, // 2024年考核等级
  year2025: 9, // 2025年考核等级
} as const;
