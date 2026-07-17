#!/usr/bin/env npx tsx
/**
 * 删除不在 2026 花名册中的用户。
 * 读取文件1（花名册），提取所有人员编号，
 * 删除不在花名册中的 User 及其关联数据。
 *
 * 用法: npx tsx scripts/clean-old-users.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { readXlsxFirstSheet } from '../src/lib/xlsx-reader';

const ROSTER_FILE = '20260716超高压人员信息表/1.能级评价员工花名册（435人 含职称 技能等级）.xlsx';
const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`模式: ${dryRun ? '试运行（不写库）' : '正式清理'}\n`);

  // 读取花名册
  const sheet = readXlsxFirstSheet(ROSTER_FILE);
  const rosterNos = new Set(
    sheet.rows.map((r: any) => String(r['人员编号'] ?? '').trim()).filter(Boolean),
  );
  console.log(`花名册: ${rosterNos.size} 人`);

  // 查找不在花名册中的用户
  const allUsers = await prisma.user.findMany({
    select: { id: true, employeeNo: true, fullName: true },
  });

  const toRemove = allUsers.filter((u) => u.employeeNo && !rosterNos.has(u.employeeNo));
  console.log(`待清理: ${toRemove.length} 人不在花名册中`);
  if (toRemove.length > 0) {
    for (const u of toRemove.slice(0, 10)) {
      console.log(`  - ${u.employeeNo} ${u.fullName}`);
    }
    if (toRemove.length > 10) console.log(`  ... 等 ${toRemove.length - 10} 人`);
  }

  if (dryRun || toRemove.length === 0) {
    console.log('\n试运行结束，未修改数据库。');
    await prisma.$disconnect();
    return;
  }

  // 删除关联数据 + 用户
  const userIds = toRemove.map((u) => u.id);
  const deletedFacts = await prisma.performanceFact.deleteMany({ where: { userId: { in: userIds } } });
  const deletedBasic = await prisma.employeeBasicFact.deleteMany({ where: { userId: { in: userIds } } });
  const deletedRoles = await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  const deletedUsers = await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log(`\n已删除:`);
  console.log(`  PerformanceFact: ${deletedFacts.count} 条`);
  console.log(`  EmployeeBasicFact: ${deletedBasic.count} 条`);
  console.log(`  UserRole: ${deletedRoles.count} 条`);
  console.log(`  User: ${deletedUsers.count} 人`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
