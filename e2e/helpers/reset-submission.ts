/**
 * E2E 用：把指定员工的模板申报重置为可编辑草稿，并清掉归档/审核痕迹。
 * 仅供本地 Playwright；不要在生产脚本复用。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function resetSubmissionForE2E(input: {
  employeeNo: string;
  templateId: string;
}) {
  const user = await prisma.user.findUnique({
    where: { employeeNo: input.employeeNo },
    select: { id: true },
  });
  if (!user) throw new Error(`E2E reset: employee ${input.employeeNo} not found`);

  const template = await prisma.formTemplate.findUnique({
    where: { id: input.templateId },
    select: { id: true, year: true },
  });
  if (!template) throw new Error(`E2E reset: template ${input.templateId} not found`);

  const submission = await prisma.submission.findUnique({
    where: { userId_templateId: { userId: user.id, templateId: template.id } },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.performanceRecord.deleteMany({
      where: { userId: user.id, year: template.year },
    });

    if (!submission) return;

    await tx.reviewLog.deleteMany({ where: { submissionId: submission.id } });
    await tx.submissionOptionReview.deleteMany({
      where: { submissionItem: { submissionId: submission.id } },
    });
    await tx.attachment.deleteMany({
      where: { submissionItem: { submissionId: submission.id } },
    });
    await tx.submissionItem.updateMany({
      where: { submissionId: submission.id },
      data: {
        status: 'DRAFT',
        confirmationStatus: null,
        disputeReason: null,
        disputeClaimedScore: null,
        disputeL1Result: null,
        disputeL1Note: null,
        disputeL1ReviewerId: null,
        disputeL1ReviewedAt: null,
        disputeL2Result: null,
        disputeL2Note: null,
        disputeL2ReviewerId: null,
        disputeL2ReviewedAt: null,
        overrideScore: null,
        overrideReason: null,
        overrideBy: null,
        overrideAt: null,
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });
    await tx.submission.update({
      where: { id: submission.id },
      data: {
        status: 'DRAFT',
        submittedAt: null,
        totalScore: 0,
        l1ReviewerId: null,
        l1ReviewedAt: null,
        l2ReviewerId: null,
        l2ReviewedAt: null,
      },
    });
  });
}

export async function disconnectE2EPrisma() {
  await prisma.$disconnect();
}
