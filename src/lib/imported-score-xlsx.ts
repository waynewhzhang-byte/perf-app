import { writeFileSync } from 'fs';
import ExcelJS from 'exceljs';
import type { BatchImportedScoresResult, ImportedScoreRow } from '@/lib/imported-score-batch';
import { summarizeImportedScoresByOrg } from '@/lib/imported-score-batch';

function autoWidth(sheet: ExcelJS.Worksheet, min = 10, max = 36) {
  sheet.columns.forEach((col) => {
    let width = min;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len + 2 > width) width = Math.min(max, len + 2);
    });
    col.width = width;
  });
}

const PERSON_HEADERS = [
  '序号',
  '工号',
  '姓名',
  '性别',
  '工区/分公司',
  '部门',
  '折算能级',
  '技能等级分',
  '职称等级分',
  '绩效等级分',
  '基本素质合计',
  '两票执行分',
  '两票原始分',
  '缺陷治理分',
  '缺陷原始分',
  '工作场合计',
  '导入维度合计',
  '导入维度满分',
];

function appendPersonRows(sheet: ExcelJS.Worksheet, rows: ImportedScoreRow[]) {
  sheet.addRow(PERSON_HEADERS);
  sheet.getRow(1).font = { bold: true };
  const sorted = [...rows].sort(
    (a, b) =>
      b.importedTotalScore - a.importedTotalScore ||
      a.employeeNo.localeCompare(b.employeeNo),
  );
  sorted.forEach((r, i) => {
    sheet.addRow([
      i + 1,
      r.employeeNo,
      r.employeeName,
      r.gender ?? '',
      r.branchName ?? '',
      r.departmentName ?? '',
      r.declarationTier ?? '一级',
      r.skillScore,
      r.titleScore,
      r.performanceLevelScore,
      r.basicScore,
      r.ticketScore,
      r.ticketRawScore ?? '',
      r.defectScore,
      r.defectRawScore ?? '',
      r.worksiteScore,
      r.importedTotalScore,
      r.importedMaxScore,
    ]);
  });
  autoWidth(sheet);
}

function appendGroupSheet(
  sheet: ExcelJS.Worksheet,
  title: string,
  groups: ReturnType<typeof summarizeImportedScoresByOrg>['byBranch'],
  showDepartment: boolean,
) {
  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 12 };
  const headers = showDepartment
    ? ['序号', '工区/分公司', '部门', '人数', '平均基本素质', '平均工作现场', '平均导入合计', '最高导入合计', '有两票人数', '有缺陷人数']
    : ['序号', '工区/分公司', '人数', '平均基本素质', '平均工作现场', '平均导入合计', '最高导入合计', '有两票人数', '有缺陷人数'];
  sheet.addRow(headers);
  sheet.getRow(2).font = { bold: true };
  groups.forEach((g, i) => {
    sheet.addRow(
      showDepartment
        ? [
            i + 1,
            g.branchName,
            g.departmentName,
            g.headcount,
            g.avgBasicScore,
            g.avgWorksiteScore,
            g.avgImportedTotal,
            g.maxImportedTotal,
            g.withTicketCount,
            g.withDefectCount,
          ]
        : [
            i + 1,
            g.branchName,
            g.headcount,
            g.avgBasicScore,
            g.avgWorksiteScore,
            g.avgImportedTotal,
            g.maxImportedTotal,
            g.withTicketCount,
            g.withDefectCount,
          ],
    );
  });
  autoWidth(sheet);
}

function appendRulesSheet(
  sheet: ExcelJS.Worksheet,
  result: BatchImportedScoresResult,
) {
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 72;
  sheet.addRow(['导入事实绩效分表 — 计算说明']).font = { bold: true, size: 14 };
  sheet.addRow([]);
  sheet.addRow(['评价年度', result.year]);
  sheet.addRow(['覆盖人数', result.total]);
  sheet.addRow([]);
  sheet.addRow(['维度', '规则摘要']);
  sheet.getRow(6).font = { bold: true };
  sheet.addRow(['基本素质（14）', '技能4 + 职称4 + 三年绩效6；档位来自《基本素质信息》导入']);
  sheet.addRow(['两票执行（30）', '原始分 ÷ 同能级最高原始分 × 30；无入职日期按一级折算']);
  sheet.addRow(['缺陷治理（12）', '危急/严重/一般矩阵计分，同人兼发现处理取高，累加封顶12']);
  sheet.addRow(['导入合计（56）', '上述三项之和；不含工作业绩等员工申报维度']);
  sheet.addRow([]);
  sheet.addRow(['各能级两票原始最高分（折算基准）']).font = { bold: true };
  for (const [tier, max] of Object.entries(result.ticketTierMaxRaw)) {
    sheet.addRow([tier, max]);
  }
}

/** 生成导入事实绩效分表 Excel Buffer */
export async function buildImportedScoresWorkbook(
  result: BatchImportedScoresResult,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'perf-app';
  wb.created = new Date();

  const person = wb.addWorksheet('个人分表');
  appendPersonRows(person, result.rows);

  const { byBranch, byDepartment } = summarizeImportedScoresByOrg(result.rows);

  const branchSheet = wb.addWorksheet('工区汇总');
  appendGroupSheet(branchSheet, `${result.year} 年 · 按工区/分公司汇总`, byBranch, false);

  const deptSheet = wb.addWorksheet('部门汇总');
  appendGroupSheet(deptSheet, `${result.year} 年 · 按部门汇总`, byDepartment, true);

  const rules = wb.addWorksheet('计算说明');
  appendRulesSheet(rules, result);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function writeImportedScoresXlsx(
  result: BatchImportedScoresResult,
  outputPath: string,
): Promise<void> {
  const buffer = await buildImportedScoresWorkbook(result);
  writeFileSync(outputPath, buffer);
}
