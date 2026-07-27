/**
 * 员工端事实记录展示模型。
 *
 * 数据库和导入器可以保留技术字段；这里统一转为中文标题、参与角色和原始业务字段，
 * 供员工申报页以及后续管理员明细导出复用。
 */
export interface PerformanceFactRecordInput {
  id: string;
  dimensionCode: string;
  dimensionTitle: string;
  score: unknown;
  role?: string | null;
  eventType?: string | null;
  defectRef?: string | null;
  defectLevel?: string | null;
  eventDate?: string | null;
  sourceFile?: string | null;
  recordKey?: string | null;
  recordType?: string | null;
  recordTitle?: string | null;
  participationRole?: string | null;
  sourceSheet?: string | null;
  sourceRowNo?: number | null;
  metadata?: unknown;
}

export interface FactRecordView {
  id: string;
  recordKey: string;
  recordType: string;
  title: string;
  roleLabel?: string;
  score: number;
  occurredAt?: string;
  details: Array<{ label: string; value: string }>;
  source: {
    file?: string;
    sheet?: string;
    rowNo?: number;
  };
}

const ROLE_LABELS: Record<string, string> = {
  FIRST_DISCOVERER: '第一发现人',
  CO_DISCOVERER: '共同发现人',
  FIRST_HANDLER: '第一处理人',
  CO_HANDLER: '共同处理人',
};

const DETAIL_LABELS: Record<string, string> = {
  station: '变电站',
  substation: '变电站',
  description: '问题描述',
  responsibleUnit: '责任单位',
  status: '状态',
  category: '业务类别',
  projectName: '项目名称',
  project: '项目名称',
  award: '奖项',
  level: '级别',
  levelRaw: '源表级别',
  reason: '事由',
  declareUnit: '申报单位',
  unit: '所在单位',
  team: '班组',
  amount: '奖励金额',
  faultCount: '故障处数',
  patentType: '专利类型',
  patentName: '专利申请人',
  patentApplicant: '专利申请人',
  applicant: '申请人',
  applicationDate: '申请日',
  grantDate: '授权日',
  legalStatus: '法律状态',
  order: '发明人顺序',
  roleRaw: '责任类型',
  rawPersonField: '源表人员',
};

const HIDDEN_METADATA_KEYS = new Set([
  'rawScore',
  'isRawScore',
  'breakdown',
  'recordKey',
  'recordType',
  'recordTitle',
  'participationRole',
  'sourceSheet',
  'sourceRowNo',
  'kind',
  'levelKey',
  'isFirstDiscoverer',
  'isCollaborative',
  'personIndex',
  'rowIndex',
  'role',
  'scoreCategory',
]);

/** 原始行完整入库，但员工视图不展示同一业务记录上的其他人员身份字段。 */
const PERSON_IDENTITY_COLUMN = /(姓名|人员编号|员工编号|工号|发现人|消缺人|处理人|负责人|许可人|操作人|监护人|配合人员|发明人|审查人员|修订人员|编写人员|会审人员)/;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join('、');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value == null ? '' : String(value).trim();
}

function detailFields(fact: PerformanceFactRecordInput): Array<{ label: string; value: string }> {
  const metadata = asObject(fact.metadata);
  const sourceData = asObject(metadata.sourceData);
  const hasSourceData = Object.keys(sourceData).length > 0;
  const detailObject = hasSourceData
    ? sourceData
    : Object.keys(asObject(metadata.details)).length > 0
      ? asObject(metadata.details)
      : metadata;
  const details: Array<{ label: string; value: string }> = [];

  if (fact.defectLevel) {
    details.push({ label: '缺陷等级', value: fact.defectLevel });
  }
  for (const [key, rawValue] of Object.entries(detailObject)) {
    if (
      key.startsWith('__')
      || HIDDEN_METADATA_KEYS.has(key)
      || key === 'sourceData'
      || key === 'details'
      || (hasSourceData && PERSON_IDENTITY_COLUMN.test(key))
    ) continue;
    const value = displayValue(rawValue);
    if (!value) continue;
    const label = hasSourceData ? key : DETAIL_LABELS[key];
    if (!label) continue;
    details.push({ label, value });
  }
  return details;
}

function fallbackTitle(
  fact: PerformanceFactRecordInput,
  metadata: Record<string, unknown>,
): string {
  if (fact.dimensionCode === 'worksite.defect-governance' && fact.defectRef) {
    return `缺陷 ${fact.defectRef}`;
  }
  if (fact.dimensionCode === 'performance.safety-contribution' && fact.defectRef) {
    return `安全贡献 ${fact.defectRef}`;
  }
  if (fact.dimensionCode.startsWith('performance.technical-contribution')) {
    return displayValue(metadata.projectName) || fact.dimensionTitle;
  }
  if (fact.dimensionCode.startsWith('performance.competition')) {
    return displayValue(metadata.award) || fact.dimensionTitle;
  }
  if (fact.dimensionCode === 'performance.innovation.award') {
    return [displayValue(metadata.award), displayValue(metadata.project)]
      .filter(Boolean)
      .join(' · ') || fact.dimensionTitle;
  }
  if (fact.dimensionCode === 'performance.innovation.paper-patent') {
    const patentType = displayValue(metadata.patentType);
    const grantDate = displayValue(metadata.grantDate);
    return ['专利记录', patentType, grantDate ? `授权日 ${grantDate}` : '']
      .filter(Boolean)
      .join(' · ');
  }
  if (fact.dimensionCode.startsWith('special.violation')) {
    return displayValue(metadata.description) || fact.dimensionTitle;
  }
  if (fact.dimensionCode === 'worksite.ticket-execution') {
    return fact.dimensionTitle || '两票执行';
  }
  if (fact.defectRef && !fact.defectRef.startsWith('ticket-aggregate-')) {
    return fact.defectRef;
  }
  return fact.dimensionTitle || '绩效事实记录';
}

function resolveRoleLabel(
  fact: PerformanceFactRecordInput,
  metadata: Record<string, unknown>,
): string {
  if (fact.participationRole) return fact.participationRole;
  const metadataParticipationRole = displayValue(metadata.participationRole);
  if (metadataParticipationRole) return metadataParticipationRole;
  if (fact.dimensionCode === 'performance.innovation.paper-patent') {
    const order = Number(metadata.order);
    return Number.isInteger(order) && order > 0 ? `第 ${order} 发明人` : '发明人';
  }
  if (fact.dimensionCode.startsWith('special.violation')) {
    return displayValue(metadata.roleRaw)
      || (fact.role ? ROLE_LABELS[fact.role] ?? '' : '');
  }
  if (
    fact.dimensionCode.startsWith('performance.technical-contribution')
    || fact.dimensionCode.startsWith('performance.competition')
    || fact.dimensionCode === 'performance.innovation.award'
    || fact.dimensionCode === 'worksite.ticket-execution'
  ) {
    const businessRole = displayValue(metadata.role);
    return businessRole && businessRole !== 'direct' && businessRole !== 'joint'
      ? businessRole
      : '';
  }
  return fact.role ? ROLE_LABELS[fact.role] ?? fact.role : '';
}

export function formatPerformanceFactRecord(
  fact: PerformanceFactRecordInput,
): FactRecordView {
  const metadata = asObject(fact.metadata);
  const recordKey = fact.recordKey
    || displayValue(metadata.recordKey)
    || fact.defectRef
    || fact.id;
  const recordType = fact.recordType
    || displayValue(metadata.recordType)
    || fact.dimensionCode;
  const title = fact.recordTitle
    || displayValue(metadata.recordTitle)
    || fallbackTitle(fact, metadata);
  const role = resolveRoleLabel(fact, metadata);
  const sourceSheet = fact.sourceSheet || displayValue(metadata.sourceSheet);
  const metadataRowNo = Number(metadata.sourceRowNo);
  const rowNo = fact.sourceRowNo
    ?? (Number.isInteger(metadataRowNo) && metadataRowNo > 0 ? metadataRowNo : undefined);

  return {
    id: fact.id,
    recordKey,
    recordType,
    title,
    ...(role ? { roleLabel: role } : {}),
    score: Number(fact.score),
    ...(fact.eventDate ? { occurredAt: fact.eventDate } : {}),
    details: detailFields(fact),
    source: {
      ...(fact.sourceFile ? { file: fact.sourceFile } : {}),
      ...(sourceSheet ? { sheet: sourceSheet } : {}),
      ...(rowNo ? { rowNo } : {}),
    },
  };
}
