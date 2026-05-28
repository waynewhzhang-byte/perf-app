import type { AppRole } from '@prisma/client';
import { prisma } from './prisma';

export type AttachmentViewKind = 'image' | 'pdf' | 'other';

export function attachmentViewKind(
  mimeType: string | null | undefined,
  filename: string,
): AttachmentViewKind {
  const mt = (mimeType ?? '').toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (mt === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'other';
}

export async function loadAttachmentForView(attachmentId: string) {
  return prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      submissionItem: {
        include: {
          submission: {
            select: { userId: true, status: true, branchId: true },
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

  if (roles.includes('REVIEWER_L2') && sub.status === 'L1_APPROVED') {
    return true;
  }

  if (roles.includes('REVIEWER_L1') && sub.status === 'SUBMITTED') {
    if (!sub.branchId) return false;
    const scopes = await prisma.userRole.findMany({
      where: { userId, role: 'REVIEWER_L1' },
      select: { scopeBranchId: true },
    });
    const branchIds = scopes
      .map((r) => r.scopeBranchId)
      .filter((id): id is string => id != null);
    return branchIds.includes(sub.branchId);
  }

  return false;
}
