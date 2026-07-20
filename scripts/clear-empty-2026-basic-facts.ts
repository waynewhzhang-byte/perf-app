/** 清除花名册中没有原始事实的 2026 基本素质记录，避免默认分被自动带入表单。 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();
const source = '20260716超高压人员信息表/1.能级评价员工花名册（435人 含职称 技能等级）.xlsx';
const text = (value: unknown) => String(value ?? '').trim();

async function main() {
  const workbook = XLSX.readFile(source, { raw: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['员工花名册']!, { header: 1, defval: '' }) as unknown[][];
  const missingSkill = rows.slice(1).filter((row) => !text(row[31])).map((row) => text(row[1])).filter(Boolean);
  const missingTitle = rows.slice(1).filter((row) => !text(row[29])).map((row) => text(row[1])).filter(Boolean);
  const invalidPerformance = await prisma.employeeBasicFact.findMany({
    where: { year: 2026, dimension: 'PERFORMANCE_LEVEL', tierValue: { in: ['//', '无', ''] } },
    select: { employeeNo: true },
  });

  const [skill, title, performance] = await prisma.$transaction([
    prisma.employeeBasicFact.deleteMany({ where: { year: 2026, dimension: 'SKILL_LEVEL', employeeNo: { in: missingSkill } } }),
    prisma.employeeBasicFact.deleteMany({ where: { year: 2026, dimension: 'TITLE_LEVEL', employeeNo: { in: missingTitle } } }),
    prisma.employeeBasicFact.deleteMany({ where: { year: 2026, dimension: 'PERFORMANCE_LEVEL', employeeNo: { in: invalidPerformance.map((row) => row.employeeNo) } } }),
  ]);
  console.log(JSON.stringify({ skill: skill.count, title: title.count, performance: performance.count }, null, 2));
}

main().finally(() => prisma.$disconnect());
