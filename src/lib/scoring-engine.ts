/**
 * 评分规则引擎
 *
 * 服务于系统导入维度（有外部数据源的维度），根据可配置的评分规则，
 * 将 PerformanceFact 事实记录转换为每位员工的维度得分。
 *
 * 三种规则类型：
 *   MATRIX   — 矩阵映射：角色 × 缺陷等级 → 固定分数
 *   SHARE    — 聚合均分：按事件分组，角色份额，N处故障乘N
 *   NORMALIZE — 折算归一：原始分 ÷ 能级最高分 × 目标满分
 *
 * 使用模式：管理员上传 Excel → 解析为 FactInput[] → 评分引擎计算 → 写入 PerformanceFact
 */

// ── Types ────────────────────────────────────────────────────────

/** 事实记录的输入形态（解析 Excel 后、计算分前） */
export interface FactInput {
  employeeNo: string;       // 工号
  employeeName: string;     // 姓名
  dimensionCode: string;    // 维度代码
  role: FactRole;           // 角色
  eventType: FactEventType; // 事件类型
  /** 缺陷等级（MATRIX 型用到），如 危急/严重/一般 */
  defectLevel?: string;
  /** 缺陷/事件编号（MATRIX 型写入 defectRef） */
  defectRef?: string;
  /** 事件/申报编号（SHARE 型按此分组聚合） */
  incidentId?: string;
  /** 故障次数（安全贡献用到，事由含 N 处故障时乘以 N） */
  faultCount?: number;
  /** 原始分（NORMALIZE 型用） */
  rawScore?: number;
  /** 所属能级（NORMALIZE 型按此分组找最高分） */
  declarationLevel?: string;
  /** 所属档位值（BASIC_TIER 型按此查表） */
  tierValue?: string;
  /** NORMALIZE 两票型：票种类（operation=操作票，work=工作票） */
  ticketKind?: 'operation' | 'work';
  /** NORMALIZE 两票型-操作票：操作步数（× operationStepPrice） */
  steps?: number;
  /** NORMALIZE 两票型-工作票：票面类型，如「总工作票」 */
  ticketType?: string;
  /** NORMALIZE 两票型-工作票：工作角色 */
  workRole?: 'workLeader' | 'workPermitter' | 'workMember';
  /** 来源文件名（写入 metadata） */
  sourceFile: string;
  /** 事件日期 */
  eventDate?: string;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

export type FactRole =
  | 'FIRST_DISCOVERER'
  | 'CO_DISCOVERER'
  | 'FIRST_HANDLER'
  | 'CO_HANDLER';

export type FactEventType = 'DISCOVERY' | 'REMEDIATION';

export type RuleType = 'MATRIX' | 'SHARE' | 'NORMALIZE' | 'BASIC_TIER';

// ── Rule Config ──────────────────────────────────────────────────

export interface ScoringRule {
  id: string;
  dimensionCode: string;
  ruleType: RuleType;
  cap: number;
  enabled: boolean;
  /** MATRIX 型：缺陷等级 → 角色 → 分数 */
  matrix?: Record<string, Record<string, number>>;
  /** 同人兼任多角色时取最高分（默认 true） */
  tieBreak?: 'MAX_PER_PERSON';
  /** SHARE 型：角色份额配置 */
  roles?: Record<string, ShareRoleConfig>;
  /** SHARE 型：按哪个字段分组 */
  groupBy?: string;
  /** BASIC_TIER 型：档位值 → 分数 */
  tiers?: Record<string, number>;
  /** BASIC_TIER 型：档位未命中时的默认分 */
  defaultScore?: number;
  /** NORMALIZE 型 */
  targetMaxScore?: number;
  sourceKey?: string;
  normalizeWithin?: string;
  /** NORMALIZE 两票型-操作票：每操作步单价 */
  operationStepPrice?: number;
  /** NORMALIZE 两票型-工作票：角色 × 票类型 → 单价 */
  ticketPrices?: TicketPriceTable;
}

export interface ShareRoleConfig {
  perIncident?: number;
  totalShare?: number;
  multiplyByFaultCount?: boolean;
  /** 总份额在哪些角色间均分 */
  splitAmong?: string;
}

/** NORMALIZE 两票型-工作票：角色 × 票类型 → 单价表 */
export interface TicketPriceTable {
  workLeader?: Record<string, number>;
  workPermitter?: Record<string, number>;
  workMember?: Record<string, number>;
}

/** 计算结果：一条 PerformanceFact 的得分 */
export interface ScoredFact extends FactInput {
  score: number;
}

// ── Engine ───────────────────────────────────────────────────────

/**
 * 对一批事实记录，按配置的评分规则计算每个事实的得分。
 * 返回带 score 字段的事实列表。
 */
export function computeFactScores(
  facts: FactInput[],
  rules: ScoringRule[],
): ScoredFact[] {
  const ruleMap = new Map(
    rules.filter((r) => r.enabled).map((r) => [r.dimensionCode, r]),
  );

  // 按维度分组处理
  const byDimension = new Map<string, FactInput[]>();
  for (const f of facts) {
    const list = byDimension.get(f.dimensionCode) ?? [];
    list.push(f);
    byDimension.set(f.dimensionCode, list);
  }

  const results: ScoredFact[] = [];

  for (const [dimCode, dimFacts] of byDimension) {
    const rule = ruleMap.get(dimCode);
    if (!rule) {
      // 未配置规则 → 跳过（不在该维度计算分数）
      continue;
    }

    switch (rule.ruleType) {
      case 'MATRIX':
        results.push(...processMatrix(dimFacts, rule));
        break;
      case 'SHARE':
        results.push(...processShare(dimFacts, rule));
        break;
      case 'NORMALIZE':
        results.push(...processNormalize(dimFacts, rule));
        break;
      case 'BASIC_TIER':
        results.push(...processBasicTier(dimFacts, rule));
        break;
    }
  }

  return results;
}

// ── MATRIX: 缺陷治理 ────────────────────────────────────────────
// 角色 × 缺陷等级 → 固定分数，同人兼发现与处理按高分计

function processMatrix(facts: FactInput[], rule: ScoringRule): ScoredFact[] {
  const matrix = rule.matrix ?? {};

  // 按 (employeeNo, defectLevel) 分组，同人对同一缺陷取最高角色分
  const key = (f: FactInput) => `${f.employeeNo}|${f.defectLevel}`;
  const groups = new Map<string, FactInput[]>();
  for (const f of facts) {
    const k = key(f);
    const list = groups.get(k) ?? [];
    list.push(f);
    groups.set(k, list);
  }

  const results: ScoredFact[] = [];
  for (const [, group] of groups) {
    let bestScore = 0;
    let bestFact: FactInput | null = null;

    for (const f of group) {
      const levelMatrix = matrix[f.defectLevel ?? ''] ?? {};
      const roleScore = levelMatrix[f.role] ?? 0;
      if (roleScore > bestScore) {
        bestScore = roleScore;
        bestFact = f;
      }
    }

    if (bestFact && bestScore > 0) {
      const capped = Math.min(bestScore, rule.cap);
      results.push({ ...bestFact, score: capped });
    }
  }

  return results;
}

// ── SHARE: 安全贡献 ─────────────────────────────────────────────
// 第一发现人 3 分/次 × N，其余发现人合计 3 分/次 × N 均分

function processShare(facts: FactInput[], rule: ScoringRule): ScoredFact[] {
  const roleConfigs = rule.roles ?? {};
  const groupBy = rule.groupBy ?? 'incidentId';

  // 按事件分组
  const groups = new Map<string, FactInput[]>();
  for (const f of facts) {
    const gk = groupBy === 'incidentId' ? (f.incidentId ?? '_singleton') : '_singleton';
    const list = groups.get(gk) ?? [];
    list.push(f);
    groups.set(gk, list);
  }

  const results: ScoredFact[] = [];

  for (const [, incidentFacts] of groups) {
    // 获取该事件的故障次数（从任意一条记录读取）
    const faultN = incidentFacts[0]?.faultCount ?? 1;

    // 按角色分组
    const byRole = new Map<string, FactInput[]>();
    for (const f of incidentFacts) {
      const list = byRole.get(f.role) ?? [];
      list.push(f);
      byRole.set(f.role, list);
    }

    for (const [role, roleFacts] of byRole) {
      const cfg = roleConfigs[role];
      if (!cfg) continue;

      if (cfg.perIncident != null) {
        // 每人固定每事件分数
        const perPerson = cfg.perIncident * (cfg.multiplyByFaultCount ? faultN : 1);
        for (const f of roleFacts) {
          results.push({ ...f, score: Math.min(perPerson, rule.cap) });
        }
      } else if (cfg.totalShare != null) {
        // 总额在这些人中均分
        const totalShare = cfg.totalShare * (cfg.multiplyByFaultCount ? faultN : 1);
        const shareCount = roleFacts.length;
        if (shareCount > 0) {
          const perPerson = totalShare / shareCount;
          for (const f of roleFacts) {
            results.push({ ...f, score: Math.min(perPerson, rule.cap) });
          }
        }
      }
    }
  }

  return results;
}

// ── NORMALIZE: 两票执行 ─────────────────────────────────────────
// 两层：单价聚合（操作票 steps×单价 / 工作票 ticketPrices[role][type]）→ rawScore；
//       再折算（rawScore ÷ 同能级最高 × 目标满分）。无单价配置时退化为读 fact.rawScore。

function computeTicketRawScore(f: FactInput, rule: ScoringRule): number {
  // 操作票
  if (f.ticketKind === 'operation' && rule.operationStepPrice != null && typeof f.steps === 'number') {
    return rule.operationStepPrice * f.steps;
  }
  // 工作票
  if (f.ticketKind === 'work' && rule.ticketPrices && f.workRole && f.ticketType) {
    const table = rule.ticketPrices[f.workRole];
    return table?.[String(f.ticketType)] ?? 0;
  }
  // 无单价信息 → 退化为 fact.rawScore（向后兼容）
  return f.rawScore ?? 0;
}

function processNormalize(facts: FactInput[], rule: ScoringRule): ScoredFact[] {
  const targetMax = rule.targetMaxScore ?? 30;
  const within = rule.normalizeWithin ?? 'declarationLevel';
  const hasUnitPrices = rule.operationStepPrice != null || rule.ticketPrices != null;

  // 1. 算每条事实的 rawScore
  const withRaw = facts.map((f) => ({
    f,
    raw: hasUnitPrices ? computeTicketRawScore(f, rule) : (f.rawScore ?? 0),
  }));

  // 2. 按 declarationLevel 分组
  const byLevel = new Map<string, { f: FactInput; raw: number }[]>();
  for (const item of withRaw) {
    const level = within === 'declarationLevel' ? (item.f.declarationLevel ?? '_all') : '_all';
    const list = byLevel.get(level) ?? [];
    list.push(item);
    byLevel.set(level, list);
  }

  // 3. 组内折算
  const results: ScoredFact[] = [];
  for (const [, levelFacts] of byLevel) {
    const maxRaw = Math.max(...levelFacts.map((x) => x.raw));
    if (maxRaw === 0) {
      for (const x of levelFacts) results.push({ ...x.f, score: 0, rawScore: x.raw });
      continue;
    }
    for (const x of levelFacts) {
      const normalized = (x.raw / maxRaw) * targetMax;
      results.push({ ...x.f, score: Math.min(normalized, rule.cap), rawScore: x.raw });
    }
  }

  return results;
}


// ── BASIC_TIER: 基础素质档位 ─────────────────────────────────────
// 档位值 → 固定分数，未命中取 defaultScore，受 cap 限制

function processBasicTier(facts: FactInput[], rule: ScoringRule): ScoredFact[] {
  const tiers = rule.tiers ?? {};
  const def = rule.defaultScore ?? 0;
  return facts.map((f) => {
    const tierValue = String(f.tierValue ?? '');
    const raw = Object.prototype.hasOwnProperty.call(tiers, tierValue)
      ? tiers[tierValue]
      : def;
    return {
      ...f,
      score: Math.min(raw, rule.cap),
      rawScore: raw,
    };
  });
}
