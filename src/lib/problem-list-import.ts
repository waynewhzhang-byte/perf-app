/**
 * 2026 问题清单（32 列）解析器。
 * 将 Excel 行转换为 ProblemListRow，再转为系统评分事实 FactInput。
 */
import type { FactInput, FactRole, FactEventType } from '@/lib/scoring-engine';

export interface ProblemListRow {
  seq: number;
  problemCategory: string;       // 问题分类: 表计问题|附件问题|配件问题...
  problemDescription: string;    // 问题描述
  problemId: string;             // 编号: TX-25-17
  substation: string;            // 变电站
  reportSource: string;          // 上报来源: 人工上传
  category: string;              // 所属类别: 缺陷
  problemTag: string | null;     // 问题标签
  severity: '危急' | '严重' | '一般'; // 等级
  equipmentClass: string;        // 设备分类
  equipmentName: string;         // 设备名称
  equipmentModel: string;        // 设备型号
  equipmentManufacturer: string; // 设备厂家
  factoryDate: string | null;    // 出厂时间
  operationDate: string | null;  // 投运时间
  firstDiscoverer: string;       // 第一发现人
  discovererNo: string | number; // 员工编号
  coDiscoverers: string | null;  // 其他共同发现人
  coDiscovererNos: string | null;// 员工编号
  problemClass: string;          // 问题类别: B|C
  responsibleUnit: string | null;// 责任单位
  plannedFixDate: string | null; // 计划消除时间
  fixDate: string | null;        // 消除时间
  needOutage: string | null;     // 需要停电
  status: string;                // 问题状态: 待消除|已消除
  discoveryDate: string;         // 发现时间
  acceptanceDate: string | null; // 验收时间
  fixMethod: string | null;      // 消缺方法
  firstFixer: string | null;     // 第一消缺人员
  fixerNo: string | number | null; // 员工编号
  coFixers: string | null;       // 其他共同消缺人员
  coFixerNos: string | null;     // 员工编号
}

const HEADER_MAP: Record<string, string> = {
  '序号': 'seq',
  '问题分类': 'problemCategory',
  '问题描述': 'problemDescription',
  '编号': 'problemId',
  '变电站': 'substation',
  '上报来源': 'reportSource',
  '所属类别': 'category',
  '问题标签': 'problemTag',
  '等级': 'severity',
  '设备分类': 'equipmentClass',
  '设备名称': 'equipmentName',
  '设备型号': 'equipmentModel',
  '设备厂家': 'equipmentManufacturer',
  '出厂时间': 'factoryDate',
  '投运时间': 'operationDate',
  '第一发现人': 'firstDiscoverer',
  '员工编号': 'discovererNo',
  '其他共同发现人': 'otherCoDiscoverers',
  '问题类别': 'problemClass',
  '责任单位': 'responsibleUnit',
  '计划消除时间': 'plannedFixDate',
  '消除时间': 'fixDate',
  '需要停电': 'needOutage',
  '问题状态': 'status',
  '发现时间': 'discoveryDate',
  '验收时间': 'acceptanceDate',
  '消缺方法': 'fixMethod',
  '第一消缺人员': 'firstFixer',
  '第一消缺人员_员工编号': 'fixerNo',
  '其他共同消缺人员': 'coFixers',
  '其他共同消缺人员_员工编号': 'coFixerNos',
};

export function parseProblemListSheet(sheet: { rows: Record<string, unknown>[] }): ProblemListRow[] {
  return sheet.rows.map((row, i) => {
    const mapped: Record<string, unknown> = {};
    for (const [header, value] of Object.entries(row)) {
      const key = HEADER_MAP[header];
      if (key) mapped[key] = value;
    }
    return {
      seq: Number(mapped.seq ?? i + 1),
      problemCategory: String(mapped.problemCategory ?? ''),
      problemDescription: String(mapped.problemDescription ?? ''),
      problemId: String(mapped.problemId ?? ''),
      substation: String(mapped.substation ?? ''),
      reportSource: String(mapped.reportSource ?? ''),
      category: String(mapped.category ?? ''),
      problemTag: mapped.problemTag ? String(mapped.problemTag) : null,
      severity: (String(mapped.severity ?? '一般')) as ProblemListRow['severity'],
      equipmentClass: String(mapped.equipmentClass ?? ''),
      equipmentName: String(mapped.equipmentName ?? ''),
      equipmentModel: String(mapped.equipmentModel ?? ''),
      equipmentManufacturer: String(mapped.equipmentManufacturer ?? ''),
      factoryDate: mapped.factoryDate ? String(mapped.factoryDate) : null,
      operationDate: mapped.operationDate ? String(mapped.operationDate) : null,
      firstDiscoverer: String(mapped.firstDiscoverer ?? ''),
      discovererNo: (mapped.discovererNo ?? '') as string | number,
      coDiscoverers: mapped.otherCoDiscoverers ? String(mapped.otherCoDiscoverers) : null,
      coDiscovererNos: null,
      problemClass: String(mapped.problemClass ?? ''),
      responsibleUnit: mapped.responsibleUnit ? String(mapped.responsibleUnit) : null,
      plannedFixDate: mapped.plannedFixDate ? String(mapped.plannedFixDate) : null,
      fixDate: mapped.fixDate ? String(mapped.fixDate) : null,
      needOutage: mapped.needOutage ? String(mapped.needOutage) : null,
      status: String(mapped.status ?? ''),
      discoveryDate: String(mapped.discoveryDate ?? ''),
      acceptanceDate: mapped.acceptanceDate ? String(mapped.acceptanceDate) : null,
      fixMethod: mapped.fixMethod ? String(mapped.fixMethod) : null,
      firstFixer: mapped.firstFixer ? String(mapped.firstFixer) : null,
      fixerNo: (mapped.fixerNo ?? null) as string | number | null,
      coFixers: mapped.coFixers ? String(mapped.coFixers) : null,
      coFixerNos: mapped.coFixerNos ? String(mapped.coFixerNos) : null,
    };
  });
}

/** 按工号+姓名混合解析的员工解析器 */
export interface EmployeeNoResolver {
  resolve(employeeNo: string | null, name: string): { employeeNo: string; employeeName: string } | null;
}

const ROLE_MAP: Record<string, FactRole> = {
  '第一发现人': 'FIRST_DISCOVERER',
  '第一消缺人员': 'FIRST_HANDLER',
  '其他共同发现人': 'CO_DISCOVERER',
  '其他共同消缺人员': 'CO_HANDLER',
};

/**
 * 将解析后的 ProblemListRow 转换为评分事实 FactInput 列表。
 * 发现人始终计入；消缺人仅当 status 为「已消除」时计入。
 */
export function problemListToFactInputs(
  rows: ProblemListRow[],
  year: number,
  resolver: EmployeeNoResolver,
): { facts: FactInput[]; unmatchedNames: string[] } {
  const facts: FactInput[] = [];
  const unmatched = new Set<string>();

  for (const row of rows) {
    const defectRef = `${row.problemId} ${row.equipmentName}`.trim();
    const defectLevel = row.severity;

    // First discoverer -> FIRST_DISCOVERER
    const discovererResolved = resolver.resolve(String(row.discovererNo), row.firstDiscoverer);
    if (!discovererResolved) {
      unmatched.add(row.firstDiscoverer);
    } else {
      facts.push({
        employeeNo: discovererResolved.employeeNo,
        employeeName: discovererResolved.employeeName,
        dimensionCode: 'worksite.defect-governance',
        role: 'FIRST_DISCOVERER' as FactRole,
        eventType: 'DISCOVERY' as FactEventType,
        defectRef,
        defectLevel,
        eventDate: row.discoveryDate,
        sourceFile: 'problem-list-import',
        metadata: { problemId: row.problemId, equipmentName: row.equipmentName },
      } as FactInput);
    }

    // Co-discoverers -> CO_DISCOVERER
    if (row.coDiscoverers) {
      const names = row.coDiscoverers.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
      for (const name of names) {
        const resolved = resolver.resolve(null, name);
        if (!resolved) {
          unmatched.add(name);
        } else {
          facts.push({
            employeeNo: resolved.employeeNo,
            employeeName: resolved.employeeName,
            dimensionCode: 'worksite.defect-governance',
            role: 'CO_DISCOVERER' as FactRole,
            eventType: 'DISCOVERY' as FactEventType,
            defectRef,
            defectLevel,
            eventDate: row.discoveryDate,
            sourceFile: 'problem-list-import',
            metadata: { problemId: row.problemId },
          } as FactInput);
        }
      }
    }

    // First fixer -> FIRST_HANDLER (only if status is 已消除)
    if (row.firstFixer && row.fixerNo && row.status === '已消除') {
      const fixerResolved = resolver.resolve(String(row.fixerNo), row.firstFixer);
      if (!fixerResolved) {
        unmatched.add(row.firstFixer);
      } else {
        facts.push({
          employeeNo: fixerResolved.employeeNo,
          employeeName: fixerResolved.employeeName,
          dimensionCode: 'worksite.defect-governance',
          role: 'FIRST_HANDLER' as FactRole,
          eventType: 'REMEDIATION' as FactEventType,
          defectRef,
          defectLevel,
          eventDate: row.fixDate ?? row.discoveryDate,
          sourceFile: 'problem-list-import',
          metadata: { problemId: row.problemId, fixMethod: row.fixMethod },
        } as FactInput);
      }
    }
  }

  return { facts, unmatchedNames: [...unmatched] };
}
