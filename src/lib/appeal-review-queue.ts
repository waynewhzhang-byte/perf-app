/**
 * 申诉中心化审核台：按申诉行（非整单）列出待审/已审，服务端强制 L1/L2 scope。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  buildL1SubmissionScopeWhere,
  matchesL1Scope,
  type L1ReviewerScope,
} from '@/lib/reviewer-scope';
import {
  isL1ReviewQueueItem,
  resolveFormItemDimension,
} from '@/lib/system-filled-items';
import {
  isReviewableDimensionCode,
} from '@/lib/dimension-review-routing';

export type AppealReviewLevel = 1 | 2;

export interface AppealReviewRow {
  submissionItemId: string;
  submissionId: string;
  employeeNo: string;
  employeeName: string;
  contact: string;
  itemTitle: string;
  dimensionCode: string | null;
  systemScore: number;
  disputeReason: string | null;
  disputeClaimedScore: number | null;
  attachments: Array<{ id: string; filename: string; mimeType: string | null }>;
  submittedAt: string | null;
  /** 已审核 tab：确认 / 驳回 */
  auditLabel?: '确认' | '驳回';
  disputeL1Result?: 'APPROVED' | 'REJECTED' | null;
  disputeL2Result?: 'APPROVED' | 'REJECTED' | null;
}

export interface AppealReviewListInput {
  level: AppealReviewLevel;
  reviewerId: string;
  l1Scopes: L1ReviewerScope[];
  l2DepartmentId: string | null;
  filter: 'pending' | 'completed';
  itemTitle?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

const itemInclude = {
  item: true,
  attachments: { select: { id: true, filename: true, mimeType: true } },
  submission: {
    include: {
      user: { select: { fullName: true, contact: true, employeeNo: true, departmentId: true } },
    },
  },
} as const;

type LoadedItem = Prisma.SubmissionItemGetPayload<{ include: typeof itemInclude }>;

export function isDisputeVisibleToL2Reviewer(
  dimensionCode: string | null,
  reviewerDepartmentId: string,
  routeByDimension: Map<string, string>,
): boolean {
  if (!dimensionCode || !isReviewableDimensionCode(dimensionCode)) {
    return true;
  }
  const dept = routeByDimension.get(dimensionCode);
  return dept != null && dept === reviewerDepartmentId;
}

export function mapAppealReviewRow(
  item: LoadedItem,
  auditLabel?: '确认' | '驳回',
): AppealReviewRow {
  return {
    submissionItemId: item.id,
    submissionId: item.submissionId,
    employeeNo: item.submission.user.employeeNo ?? '',
    employeeName: item.submission.user.fullName,
    contact: item.submission.user.contact,
    itemTitle: item.item.title,
    dimensionCode: resolveFormItemDimension(item.item),
    systemScore: Number(item.score),
    disputeReason: item.disputeReason,
    disputeClaimedScore: item.disputeClaimedScore != null ? Number(item.disputeClaimedScore) : null,
    attachments: item.attachments,
    submittedAt: item.submission.submittedAt?.toISOString() ?? null,
    auditLabel,
    disputeL1Result: item.disputeL1Result,
    disputeL2Result: item.disputeL2Result,
  };
}

function matchesKeyword(row: AppealReviewRow, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return [
    row.employeeNo,
    row.employeeName,
    row.contact,
    row.itemTitle,
    row.disputeReason ?? '',
  ].some((part) => part.toLowerCase().includes(q));
}

function matchesItemTitle(row: AppealReviewRow, itemTitle?: string): boolean {
  if (!itemTitle?.trim()) return true;
  return row.itemTitle.includes(itemTitle.trim());
}

function l1AuditLabel(item: LoadedItem): '确认' | '驳回' | undefined {
  if (item.disputeL1Result === 'APPROVED') return '确认';
  if (item.disputeL1Result === 'REJECTED') return '驳回';
  return undefined;
}

function l2AuditLabel(item: LoadedItem): '确认' | '驳回' | undefined {
  if (item.disputeL2Result === 'APPROVED') return '确认';
  if (item.disputeL2Result === 'REJECTED') return '驳回';
  return undefined;
}

export async function listAppealReviewRows(
  db: Db,
  input: AppealReviewListInput,
): Promise<{ rows: AppealReviewRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));

  const routes = await db.dimensionReviewRoute.findMany();
  const routeByDimension = new Map(routes.map((r) => [r.dimensionCode, r.departmentId]));

  let items: LoadedItem[] = [];

  if (input.level === 1) {
    const l1ScopeWhere = buildL1SubmissionScopeWhere(input.l1Scopes);
    if (!l1ScopeWhere) {
      return { rows: [], total: 0, page, pageSize };
    }

    if (input.filter === 'pending') {
      items = await db.submissionItem.findMany({
        where: {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          status: 'PENDING_L1',
          submission: {
            status: 'SUBMITTED',
            ...l1ScopeWhere,
          },
        },
        include: itemInclude,
        orderBy: { submission: { submittedAt: 'asc' } },
      });
      items = items.filter((item) =>
        matchesL1Scope(input.l1Scopes, {
          branchId: item.submission.branchId,
          departmentId: item.submission.user.departmentId,
        }),
      );
    } else {
      items = await db.submissionItem.findMany({
        where: {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          disputeL1ReviewerId: input.reviewerId,
          disputeL1Result: { not: null },
          submission: l1ScopeWhere,
        },
        include: itemInclude,
        orderBy: { disputeL1ReviewedAt: 'desc' },
      });
    }
  } else {
    if (!input.l2DepartmentId) {
      return { rows: [], total: 0, page, pageSize };
    }

    if (input.filter === 'pending') {
      items = await db.submissionItem.findMany({
        where: {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          disputeL1Result: 'APPROVED',
          disputeL2Result: null,
          submission: { status: 'L1_APPROVED' },
        },
        include: itemInclude,
        orderBy: { submission: { submittedAt: 'asc' } },
      });
      items = items.filter((item) => {
        const code = resolveFormItemDimension(item.item);
        return isDisputeVisibleToL2Reviewer(code, input.l2DepartmentId!, routeByDimension);
      });
    } else {
      items = await db.submissionItem.findMany({
        where: {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          disputeL2ReviewerId: input.reviewerId,
          disputeL2Result: { not: null },
        },
        include: itemInclude,
        orderBy: { disputeL2ReviewedAt: 'desc' },
      });
      items = items.filter((item) => {
        const code = resolveFormItemDimension(item.item);
        return isDisputeVisibleToL2Reviewer(code, input.l2DepartmentId!, routeByDimension);
      });
    }
  }

  const mapped = items.map((item) => {
    const audit = input.filter === 'completed'
      ? (input.level === 1 ? l1AuditLabel(item) : l2AuditLabel(item))
      : undefined;
    return mapAppealReviewRow(item, audit);
  });

  const filtered = mapped.filter(
    (row) => matchesItemTitle(row, input.itemTitle) && matchesKeyword(row, input.keyword ?? ''),
  );

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);

  return { rows, total, page, pageSize };
}

/** L1 待审申诉行是否应进入 applyL1 队列（与列表一致） */
export function isAppealL1PendingItem(item: {
  status: string;
  isSystemFilled: boolean;
  confirmationStatus: string | null;
}): boolean {
  return isL1ReviewQueueItem({
    status: item.status,
    isSystemFilled: item.isSystemFilled,
    confirmationStatus: item.confirmationStatus as 'CONFIRMED' | 'DISPUTED' | null,
  });
}
