/** 从《人员考核结果（435人）》恢复 2026 年绩效等级事实。 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { scorePerformanceLevel } from '../src/lib/basic-quality';

const prisma = new PrismaClient();
const sourceFile = '20260716超高压人员信息表/2.人员考核结果（435人）.xlsx';
const text = (value: unknown) => String(value ?? '').trim();

async function main() {
  const workbook = XLSX.readFile(sourceFile, { raw: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet0!, { header: 1, defval: '' }) as unknown[][];
  const sourceRows = rows.slice(2).map((row) => ({
    employeeNo: text(row[1]),
    employeeName: text(row[2]),
    grades: [text(row[9]), text(row[10]), text(row[11])],
  })).filter((row) => row.employeeNo && row.employeeName);
  const users = await prisma.user.findMany({
    where: { employeeNo: { in: sourceRows.map((row) => row.employeeNo) } },
    select: { id: true, employeeNo: true },
  });
  const userIdByNo = new Map(users.flatMap((user) => user.employeeNo ? [[user.employeeNo, user.id] as const] : []));

  for (const row of sourceRows) {
    const score = scorePerformanceLevel(row.grades);
    await prisma.employeeBasicFact.upsert({
      where: { year_employeeNo_dimension: { year: 2026, employeeNo: row.employeeNo, dimension: 'PERFORMANCE_LEVEL' } },
      update: {
        employeeName: row.employeeName,
        userId: userIdByNo.get(row.employeeNo) ?? null,
        tierValue: score.code,
        yearBreakdown: { '2023': row.grades[0] || null, '2024': row.grades[1] || null, '2025': row.grades[2] || null },
        score: score.score,
        sourceFile,
      },
      create: {
        year: 2026,
        employeeNo: row.employeeNo,
        employeeName: row.employeeName,
        userId: userIdByNo.get(row.employeeNo) ?? null,
        dimension: 'PERFORMANCE_LEVEL',
        tierValue: score.code,
        yearBreakdown: { '2023': row.grades[0] || null, '2024': row.grades[1] || null, '2025': row.grades[2] || null },
        score: score.score,
        sourceFile,
      },
    });
  }
  console.log(JSON.stringify({ restored: sourceRows.length }, null, 2));
}

main().finally(() => prisma.$disconnect());
