/**
 * E2E 前置：把一级/二级审核员密码统一为 Test1234!（本地库可重复执行）。
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/password';

const prisma = new PrismaClient();

export async function ensureReviewerPasswords(password = 'Test1234!') {
  const hash = await hashPassword(password);
  const reviewers = await prisma.user.findMany({
    where: { roles: { some: { role: { in: ['REVIEWER_L1', 'REVIEWER_L2'] } } } },
    select: { id: true },
  });
  for (const reviewer of reviewers) {
    await prisma.user.update({
      where: { id: reviewer.id },
      data: { passwordHash: hash },
    });
  }
  return reviewers.length;
}

export async function disconnectReviewerPasswordPrisma() {
  await prisma.$disconnect();
}
