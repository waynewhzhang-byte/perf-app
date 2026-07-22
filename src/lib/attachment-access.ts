import type { AppRole } from '@prisma/client';
import { prisma } from './prisma';
import { matchesL1Scope } from './reviewer-scope';

export type AttachmentViewKind = 'image' | 'pdf' | 'other';

export function attachmentViewKind(
  mimeType: string | null | undefined,
  filename: string,
): AttachmentViewKind {
  const mt = (mimeType ?? '').toLowerCase();
  const lower = filename.toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lower)) return 'image';
  if (mt === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  return 'other';
}

export async function loadAttachmentForView(attachmentId: string) {
  return prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      submissionItem: {
        include: {
          submission: {
            select: {
              userId: true,
              status: true,
              branchId: true,
              user: { select: { departmentId: true } },
            },
          },
        },
      },
    },
  });
}

/** 申报人本人，或当前可审核该申报的一/二级审核员 */
export async function canViewAttachment(
  userId: string,
  roles: AppRole[],
  att: NonNullable<Awaited<ReturnType<typeof loadAttachmentForView>>>,
): Promise<boolean> {
  const sub = att.submissionItem.submission;
  if (sub.userId === userId) return true;
  if (roles.includes('ADMIN')) return true;

  if (roles.includes('REVIEWER_L2') && (sub.status === 'L1_APPROVED' || sub.status === 'L2_APPROVED' || sub.status === 'REJECTED')) {
    return true;
  }

  if (roles.includes('REVIEWER_L1') && (sub.status === 'SUBMITTED' || sub.status === 'L1_APPROVED' || sub.status === 'L2_APPROVED' || sub.status === 'REJECTED')) {
    if (!sub.branchId) return false;
    const scopes = await prisma.userRole.findMany({
      where: { userId, role: 'REVIEWER_L1' },
      select: { scopeBranchId: true, scopeDepartmentId: true },
    });
    return matchesL1Scope(scopes, {
      branchId: sub.branchId,
      departmentId: sub.user.departmentId,
    });
  }

  return false;
}
