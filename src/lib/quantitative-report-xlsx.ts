import ExcelJS from 'exceljs';
import type { DeclarationTier, QuantitativeReportBundle, QuantitativeReportRow } from '@/lib/quantitative-report';
import type { DefectDetailExportRow } from '@/lib/quantitative-report';
import { DEFECT_LIBRARY_DIMENSION, SAFETY_CONTRIBUTION_DIMENSION, TICKET_EXECUTION_DIMENSION } from '@/lib/evaluation-dimensions';

const TIERS: DeclarationTier[] = ['一级', '二级', '三级'];

function setHeaderRows(sheet: ExcelJS.Worksheet, titleYear: number, tier: DeclarationTier) {
  const title = `国网山西超高压变电公司${titleYear}年能级评价个人量化积分统计公示表`;
  sheet.mergeCells('A1:U1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A1').font = { bold: true, size: 14 };

  sheet.getCell('A2').value = '序号';
  sheet.mergeCells('B2:G2');
  sheet.getCell('B2').value = '个人信息';
  sheet.mergeCells('H2:J2');
  sheet.getCell('H2').value = '基本素质';
  sheet.mergeCells('K2:Q2');
  sheet.getCell('K2').value = '工作业绩';
  sheet.mergeCells('R2:S2');
  sheet.getCell('R2').value = '工作现场';
  sheet.mergeCells('T2:U2');
  sheet.getCell('T2').value = '特殊事项';

  const specialtyLabel = tier === '一级' ? '所属专业' : '申报专业';
  sheet.getRow(3).values = [
    undefined,
    '姓名',
    '性别',
    '所在单位',
    specialtyLabel,
    '岗位职务',
    `工作年限（截至${titleYear}年5月）`,
    '技能等级',
    '职称等级',
    '绩效等级',
    '安全贡献',
    '技术贡献',
    undefined,
    '竞赛比武',
    undefined,
    '发明创新',
    undefined,
    '两票执行',
    '缺陷治理',
    '扣分项',
    undefined,
  ];

  sheet.getRow(4).values = [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    '国标、行标、企标',
    '规范标准、资源库',
    '生产类竞赛',
    '生产类调考',
    '创新奖项',
    '论文专利',
    undefined,
    undefined,
    '严重违章',
    '一般违章',
  ];

  for (const addr of ['A2', 'B2', 'H2', 'K2', 'R2', 'T2']) {
    sheet.getCell(addr).alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell(addr).font = { bold: true };
  }
  sheet.getRow(3).font = { bold: true };
  sheet.getRow(4).font = { bold: true };
}

function appendDataRow(sheet: ExcelJS.Worksheet, rowIndex: number, data: QuantitativeReportRow) {
  const r = sheet.getRow(rowIndex);
  r.values = [
    undefined,
    data.seq,
    data.fullName,
    data.gender,
    data.unit,
    data.specialty,
    data.position,
    data.workYears,
    data.skillLevel,
    data.titleLevel,
    data.performanceLevel,
    data.safetyContribution,
    data.technicalStandard,
    data.technicalResource,
    data.competitionEvent,
    data.competitionExam,
    data.innovationAward,
    data.innovationPaper,
    data.ticketExecution,
    data.defectGovernance,
    data.violationSevere,
    data.violationGeneral,
  ];
  r.getCell(19).numFmt = data.defectGovernance % 1 === 0 ? '0' : '0.0';
  r.getCell(18).numFmt = data.ticketExecution % 1 === 0 ? '0' : '0.0';
}

function appendFooter(sheet: ExcelJS.Worksheet, rowIndex: number) {
  sheet.mergeCells(`A${rowIndex}:G${rowIndex}`);
  sheet.getCell(`A${rowIndex}`).value = '经办人（签字）：';
  sheet.mergeCells(`R${rowIndex}:S${rowIndex}`);
  sheet.getCell(`R${rowIndex}`).value = '主任签字：';
}

function autoWidth(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((col) => {
    col.width = 14;
  });
  sheet.getColumn(2).width = 10;
  sheet.getColumn(4).width = 16;
  sheet.getColumn(5).width = 28;
}

export async function writeQuantitativeReportXlsx(
  bundle: QuantitativeReportBundle,
  outputPath: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'perf-app';
  wb.created = new Date();

  for (const tier of TIERS) {
    const sheet = wb.addWorksheet(tier);
    setHeaderRows(sheet, bundle.reportTitleYear, tier);
    const tierRows = bundle.byTier[tier];
    let rowIdx = 5;
    for (const data of tierRows) {
      appendDataRow(sheet, rowIdx, data);
      rowIdx += 1;
    }
    appendFooter(sheet, rowIdx);
    autoWidth(sheet);
  }

  const rules = wb.addWorksheet('积分规则');
  rules.getColumn(1).width = 22;
  rules.getColumn(2).width = 80;
  rules.addRow(['评价维度', '工作现场 → 缺陷治理']);
  rules.addRow(['维度代码', DEFECT_LIBRARY_DIMENSION.code]);
  rules.addRow(['满分', DEFECT_LIBRARY_DIMENSION.maxScore]);
  rules.addRow(['认定部门', DEFECT_LIBRARY_DIMENSION.ownerDepartment]);
  rules.addRow(['评价依据', DEFECT_LIBRARY_DIMENSION.evidenceSource]);
  rules.addRow(['计分规则', DEFECT_LIBRARY_DIMENSION.scoringSummary]);
  rules.addRow(['评价年度', bundle.year]);
  rules.addRow(['过滤说明', bundle.defectImport.filterNote]);
  rules.addRow([]);
  rules.addRow(['危急缺陷', '第一发现人3分，共同发现人1分；第一处理人3分，共同处理人1分']);
  rules.addRow(['严重缺陷', '第一发现人1分，共同发现人0.5分；第一处理人1分，共同处理人0.5分']);
  rules.addRow(['一般缺陷', '第一发现人0.5分；第一处理人0.5分']);
  rules.addRow(['约束', '与安全突出贡献不重复；同人兼发现与处理按高分计；子项封顶12分']);
  rules.addRow([]);
  rules.addRow(['评价维度', '工作现场 → 两票执行']);
  rules.addRow(['维度代码', TICKET_EXECUTION_DIMENSION.code]);
  rules.addRow(['满分', TICKET_EXECUTION_DIMENSION.maxScore]);
  rules.addRow(['认定部门', TICKET_EXECUTION_DIMENSION.ownerDepartment]);
  rules.addRow(['评价依据', TICKET_EXECUTION_DIMENSION.evidenceSource]);
  rules.addRow(['计分规则', TICKET_EXECUTION_DIMENSION.scoringSummary]);
  if (bundle.ticketImport) {
    rules.addRow(['两票源文件', bundle.ticketImport.sourceFile]);
    rules.addRow(['两票工作表', bundle.ticketImport.sheetName]);
    rules.addRow(['两票人数', bundle.ticketImport.entries.length]);
    rules.addRow(['折算说明', bundle.ticketScalingNote]);
    const tierMax = {
      一级: Math.max(0, ...bundle.rows.filter((r) => r.tier === '一级').map((r) => r.rawTicketScore)),
      二级: Math.max(0, ...bundle.rows.filter((r) => r.tier === '二级').map((r) => r.rawTicketScore)),
      三级: Math.max(0, ...bundle.rows.filter((r) => r.tier === '三级').map((r) => r.rawTicketScore)),
    };
    rules.addRow(['能级原始最高分', `一级 ${tierMax.一级} / 二级 ${tierMax.二级} / 三级 ${tierMax.三级}`]);
  }
  rules.addRow([]);
  rules.addRow(['评价维度', '工作业绩 → 安全贡献']);
  rules.addRow(['维度代码', SAFETY_CONTRIBUTION_DIMENSION.code]);
  rules.addRow(['满分', SAFETY_CONTRIBUTION_DIMENSION.maxScore]);
  rules.addRow(['认定部门', SAFETY_CONTRIBUTION_DIMENSION.ownerDepartment]);
  rules.addRow(['评价依据', SAFETY_CONTRIBUTION_DIMENSION.evidenceSource]);
  rules.addRow(['计分规则', SAFETY_CONTRIBUTION_DIMENSION.scoringSummary]);
  if (bundle.safetyImport) {
    rules.addRow(['突出贡献源文件', bundle.safetyImport.sourceFile]);
    rules.addRow(['突出贡献工作表', bundle.safetyImport.sheetName]);
    rules.addRow(['突出贡献人数', bundle.safetyImport.byEmployee.length]);
    rules.addRow(['过滤说明', bundle.safetyImport.filterNote]);
    rules.addRow(['N处故障', '事由含「N处故障」时，该编号按 N 次计分（第一发现人 3×N，其他发现人合计 3×N）']);
  }

  const detail = wb.addWorksheet('缺陷明细与计分');
  const defectHeaders = [
    '工号',
    '姓名',
    '维度',
    '角色',
    '事件类型',
    '单项得分',
    '缺陷编号',
    '缺陷等级',
    '事件日期',
    '序号',
    '是否为缺陷',
    '问题分类',
    '问题描述',
    '变电站',
    '设备分类',
    '设备名称',
    '发现人',
    '消缺人',
    '发现时间',
    '消缺时间',
    '问题状态',
    '责任单位',
    '消缺方法',
  ];
  detail.addRow(defectHeaders);
  detail.getRow(1).font = { bold: true };
  for (const d of bundle.detailRows) {
    const s = d.sourceRow;
    detail.addRow([
      d.employeeNo,
      d.employeeName,
      d.dimensionTitle,
      d.role,
      d.eventType,
      d.itemScore,
      d.defectRef,
      d.defectLevel,
      d.eventDate,
      s.序号,
      s.是否为缺陷,
      s.问题分类,
      s.问题描述,
      s.变电站,
      s.设备分类,
      s.设备名称,
      s.发现人,
      s.消缺人,
      s.发现时间,
      s.消缺时间,
      s.问题状态,
      s.责任单位,
      s.消缺方法,
    ]);
  }
  detail.columns.forEach((c) => {
    c.width = 14;
  });
  detail.getColumn(13).width = 40;

  if (bundle.safetyDetailRows.length > 0) {
    const safety = wb.addWorksheet('安全贡献明细');
    safety.addRow([
      '工号',
      '姓名',
      '维度',
      '角色',
      '单项得分',
      '申报编号',
      '申报时间',
      '事由',
      '申报单位',
      '所在单位',
      '故障次数',
    ]);
    safety.getRow(1).font = { bold: true };
    for (const d of bundle.safetyDetailRows) {
      safety.addRow([
        d.employeeNo,
        d.employeeName,
        d.dimensionTitle,
        d.role,
        d.itemScore,
        d.incidentRef,
        d.eventDate,
        d.reason,
        d.declareUnit,
        d.unit,
        d.faultCount,
      ]);
    }
    safety.getColumn(8).width = 48;
    safety.columns.forEach((c) => {
      if (!c.width) c.width = 14;
    });
  }

  const roster = wb.addWorksheet('工号名册');
  roster.addRow([
    '工号',
    '姓名',
    '缺陷治理得分',
    '缺陷原始分',
    '安全贡献',
    '安全原始分',
    '两票执行',
    '两票原始分',
    '本能级两票最高原始分',
    '缺陷事实条数',
    '安全事实条数',
    '能级分组',
  ]);
  roster.getRow(1).font = { bold: true };
  for (const row of bundle.rows) {
    roster.addRow([
      row.employeeNo,
      row.fullName,
      row.defectGovernance,
      row.rawDefectScore,
      row.safetyContribution,
      row.rawSafetyScore,
      row.ticketExecution,
      row.rawTicketScore,
      row.ticketTierMaxRaw,
      row.factCount,
      row.safetyFactCount,
      row.tier,
    ]);
  }
  roster.columns.forEach((c) => {
    c.width = 18;
  });

  await wb.xlsx.writeFile(outputPath);
}
