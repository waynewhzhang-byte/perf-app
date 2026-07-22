import { writeFileSync } from 'fs';
import ExcelJS from 'exceljs';
import type { BatchImportedScoresResult, ImportedScoreRow } from '@/lib/imported-score-batch';
import { summarizeImportedScoresByOrg } from '@/lib/imported-score-batch';
import { sourceDimensionTitle } from '@/lib/scoring-standards';

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

function personHeaders(year: number) {
  return [
  '序号',
  '工号',
  '姓名',
  '性别',
  '工区/分公司',
  '部门',
  '参加工作时间',
  `参评能级（截至${year}-07-31）`,
  '一级：基本素质（14）',
  '二级：技能等级（4）',
  '二级：职称等级（4）',
  '二级：绩效等级（6）',
  '一级：工作业绩（44）',
  '二级：安全贡献（12）',
  '二级：技术贡献（12）',
  '二级：竞赛比武（10）',
  '二级：发明创新（10）',
  '一级：工作现场（42）',
  '二级：两票执行（30）',
  '两票原始分',
  '二级：缺陷治理（12）',
  '缺陷原始分',
  '一级：特殊事项（扣分）',
  '正向积分合计（100）',
  '最终绩效积分（扣分后）',
  ];
}

function appendPersonRows(sheet: ExcelJS.Worksheet, rows: ImportedScoreRow[], year: number) {
  sheet.addRow(personHeaders(year));
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
      r.workStartDate ? r.workStartDate.toISOString().slice(0, 10) : '',
      r.declarationTier ?? '',
      r.basicScore,
      r.skillScore,
      r.titleScore,
      r.performanceLevelScore,
      r.performanceScore,
      r.safetyScore,
      r.technicalContributionScore,
      r.competitionScore,
      r.innovationScore,
      r.worksiteScore,
      r.ticketScore,
      r.ticketRawScore ?? '',
      r.defectScore,
      r.defectRawScore ?? '',
      r.deductionScore ? -r.deductionScore : '',
      r.importedTotalScore,
      r.finalTotalScore,
    ]);
  });
  autoWidth(sheet);
}

function appendThirdLevelFactRows(sheet: ExcelJS.Worksheet, rows: ImportedScoreRow[]) {
  sheet.addRow([
    '序号',
    '工号',
    '姓名',
    '一级维度',
    '一级维度得分',
    '二级考核维度',
    '二级维度得分（封顶后）',
    '三级事实维度',
    '事实明细',
    '原始事实积分',
    '原始导入文件',
  ]);
  sheet.getRow(1).font = { bold: true };

  let index = 0;
  for (const row of [...rows].sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))) {
    for (const section of row.sheet?.sections ?? []) {
      for (const item of section.items) {
        for (const line of item.lines) {
          if (!line.sourceDimensionCode) continue;
          index++;
          sheet.addRow([
            index,
            row.employeeNo,
            row.employeeName,
            section.title,
            section.score,
            item.title,
            item.score,
            sourceDimensionTitle(line.sourceDimensionCode),
            [line.label, line.detail].filter(Boolean).join('；'),
            line.score,
            line.sourceFile ?? '',
          ]);
        }
      }
    }
  }
  sheet.autoFilter = { from: 'A1', to: 'K1' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  autoWidth(sheet, 12, 48);
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
  sheet.addRow(['一级维度：基本素质（14）', '二级：技能4 + 职称4 + 三年绩效6；档位来自原始基本信息与考核结果']);
  sheet.addRow(['一级维度：工作业绩（44）', '二级：安全贡献12 + 技术贡献12 + 竞赛比武10 + 发明创新10；均按评分标准封顶']);
  sheet.addRow(['一级维度：工作现场（42）', '二级：两票执行30 + 缺陷治理12；两票按同专业最高原始分折算']);
  sheet.addRow(['一级维度：特殊事项', '严重/一般违章按评分标准扣分；最终绩效积分 = 正向积分合计 - 扣分']);
  sheet.addRow(['三级事实明细', '逐条列出已导入事实的一级、二级、三级维度、原始积分和来源文件；二级维度得分为同类事实汇总并按评分标准封顶后的结果']);
  sheet.addRow(['参评能级', `按参加工作时间计算工龄，截至 ${result.year} 年 7 月 31 日：0—4 年三级、5—8 年二级、9 年及以上一级`]);
  sheet.addRow([]);
  sheet.addRow(['各专业两票原始最高分（折算基准）']).font = { bold: true };
  for (const [specialty, max] of Object.entries(result.ticketSpecialtyMaxRaw)) {
    sheet.addRow([specialty, max]);
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
  appendPersonRows(person, result.rows, result.year);

  const thirdLevelFacts = wb.addWorksheet('三级事实明细');
  appendThirdLevelFactRows(thirdLevelFacts, result.rows);

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
