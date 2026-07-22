#!/usr/bin/env npx tsx
/** 将 2026 花名册 profile.参加工作时间同步到 User.hireDate。 */
import { prisma } from '@/lib/prisma';
import { workStartDateFromProfile } from '@/lib/declaration-level';

async function main() {
  const basicEmployees = await prisma.employeeBasicFact.groupBy({ by: ['employeeNo'], where: { year: 2026 } });
  const users = await prisma.user.findMany({
    where: { employeeNo: { in: basicEmployees.map((row) => row.employeeNo) } },
    select: { id: true, hireDate: true, profile: true },
  });
  const updates = users.flatMap((user) => {
    const hireDate = workStartDateFromProfile(user.profile);
    return hireDate ? [{ id: user.id, hireDate }] : [];
  });
  await prisma.$transaction(updates.map((update) => prisma.user.update({ where: { id: update.id }, data: { hireDate: update.hireDate } })));
  console.log(JSON.stringify({ rosterEmployees: users.length, updated: updates.length, missingWorkStartDate: users.length - updates.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
