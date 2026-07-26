/**
 * 申诉中心化审核台：按申诉行（非整单）列出待审/已审，服务端强制 L1/L2 scope。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  buildL1SubmissionScopeWhere,
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
  /** 单位展示：工区 · 部门 */
  unitName: string;
  workAreaName: string | null;
  departmentName: string | null;
  declarationSpecialtyId: string | null;
  declarationSpecialtyName: string | null;
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
  declarationSpecialtyId?: string;
  /** 单位 = 工区（申报快照 branchId，回退员工档案工区） */
  branchId?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

const itemInclude = {
  item: true,
  attachments: { select: { id: true, filename: true, mimeType: true } },
  submission: {
    include: {
      user: {
        select: {
          fullName: true,
          contact: true,
          employeeNo: true,
          departmentId: true,
          branch: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

type LoadedItem = Prisma.SubmissionItemGetPayload<{ include: typeof itemInclude }>;

/** 单位文案：工区 · 部门 */
export function formatEmployeeUnit(
  workAreaName: string | null | undefined,
  branchName: string | null | undefined,
  departmentName: string | null | undefined,
): string {
  const area = (workAreaName || branchName || '').trim();
  const dept = (departmentName || '').trim();
  if (area && dept) return `${area} · ${dept}`;
  return area || dept || '—';
}

export function dimensionCodesForL2Department(
  routeByDimension: Map<string, string>,
  departmentId: string,
): string[] {
  return [...routeByDimension.entries()]
    .filter(([, deptId]) => deptId === departmentId)
    .map(([code]) => code);
}

export function isDisputeVisibleToL2Reviewer(
  dimensionCode: string | null,
  reviewerDepartmentId: string,
  routeByDimension: Map<string, string>,
): boolean {
  if (!dimensionCode) return false;
  if (!isReviewableDimensionCode(dimensionCode)) {
    return true;
  }
  const dept = routeByDimension.get(dimensionCode);
  return dept != null && dept === reviewerDepartmentId;
}

export function mapAppealReviewRow(
  item: LoadedItem,
  auditLabel?: '确认' | '驳回',
): AppealReviewRow {
  const workAreaName = item.submission.workAreaName ?? item.submission.user.branch?.name ?? null;
  const departmentName = item.submission.user.department?.name ?? null;
  return {
    submissionItemId: item.id,
    submissionId: item.submissionId,
    employeeNo: item.submission.user.employeeNo ?? '',
    employeeName: item.submission.user.fullName,
    contact: item.submission.user.contact,
    unitName: formatEmployeeUnit(item.submission.workAreaName, item.submission.user.branch?.name, departmentName),
    workAreaName,
    departmentName,
    declarationSpecialtyId: item.submission.declarationSpecialtyId ?? null,
    declarationSpecialtyName: item.submission.declarationSpecialtyName ?? null,
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

function buildKeywordWhere(keyword?: string): Prisma.SubmissionItemWhereInput | undefined {
  const q = keyword?.trim();
  if (!q) return undefined;
  return {
    OR: [
      { submission: { user: { employeeNo: { contains: q, mode: 'insensitive' } } } },
      { submission: { user: { fullName: { contains: q, mode: 'insensitive' } } } },
      { submission: { user: { contact: { contains: q, mode: 'insensitive' } } } },
      { item: { title: { contains: q, mode: 'insensitive' } } },
      { disputeReason: { contains: q, mode: 'insensitive' } },
    ],
  };
}

function buildItemTitleWhere(itemTitle?: string): Prisma.SubmissionItemWhereInput | undefined {
  const title = itemTitle?.trim();
  if (!title) return undefined;
  return { item: { title: { contains: title, mode: 'insensitive' } } };
}

function buildSpecialtyWhere(declarationSpecialtyId?: string): Prisma.SubmissionItemWhereInput | undefined {
  const id = declarationSpecialtyId?.trim();
  if (!id) return undefined;
  return { submission: { declarationSpecialtyId: id } };
}

function buildBranchWhere(branchId?: string): Prisma.SubmissionItemWhereInput | undefined {
  const id = branchId?.trim();
  if (!id) return undefined;
  return {
    submission: {
      OR: [
        { branchId: id },
        { branchId: null, user: { branchId: id } },
      ],
    },
  };
}

function buildDepartmentWhere(departmentId?: string): Prisma.SubmissionItemWhereInput | undefined {
  const id = departmentId?.trim();
  if (!id) return undefined;
  return { submission: { user: { departmentId: id } } };
}

function mergeWhere(
  ...parts: Array<Prisma.SubmissionItemWhereInput | undefined>
): Prisma.SubmissionItemWhereInput {
  const and = parts.filter((part): part is Prisma.SubmissionItemWhereInput => part != null);
  return and.length === 1 ? and[0]! : { AND: and };
}

function buildListFilters(input: AppealReviewListInput): Array<Prisma.SubmissionItemWhereInput | undefined> {
  return [
    buildItemTitleWhere(input.itemTitle),
    buildKeywordWhere(input.keyword),
    buildSpecialtyWhere(input.declarationSpecialtyId),
    buildBranchWhere(input.branchId),
    buildDepartmentWhere(input.departmentId),
  ];
}

export async function listAppealReviewRows(
  db: Db,
  input: AppealReviewListInput,
): Promise<{ rows: AppealReviewRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));

  const routes = await db.dimensionReviewRoute.findMany();
  const routeByDimension = new Map(routes.map((r) => [r.dimensionCode, r.departmentId]));

  let where: Prisma.SubmissionItemWhereInput;
  let orderBy: Prisma.SubmissionItemOrderByWithRelationInput | Prisma.SubmissionItemOrderByWithRelationInput[];

  if (input.level === 1) {
    const l1ScopeWhere = buildL1SubmissionScopeWhere(input.l1Scopes);
    if (!l1ScopeWhere) {
      return { rows: [], total: 0, page, pageSize };
    }

    if (input.filter === 'pending') {
      where = mergeWhere(
        {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          status: 'PENDING_L1',
          submission: {
            status: 'SUBMITTED',
            ...l1ScopeWhere,
          },
        },
        ...buildListFilters(input),
      );
      orderBy = { submission: { submittedAt: 'asc' } };
    } else {
      where = mergeWhere(
        {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          disputeL1ReviewerId: input.reviewerId,
          disputeL1Result: { not: null },
          submission: l1ScopeWhere,
        },
        ...buildListFilters(input),
      );
      orderBy = { disputeL1ReviewedAt: 'desc' };
    }
  } else {
    if (!input.l2DepartmentId) {
      return { rows: [], total: 0, page, pageSize };
    }

    const routedCodes = dimensionCodesForL2Department(routeByDimension, input.l2DepartmentId);
    const dimensionWhere: Prisma.SubmissionItemWhereInput = routedCodes.length > 0
      ? { item: { dimensionCode: { in: routedCodes } } }
      : { item: { dimensionCode: { in: ['__no_routed_dimensions__'] } } };

    if (input.filter === 'pending') {
      where = mergeWhere(
        {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          disputeL1Result: 'APPROVED',
          disputeL2Result: null,
          submission: { status: 'L1_APPROVED' },
        },
        dimensionWhere,
        ...buildListFilters(input),
      );
      orderBy = { submission: { submittedAt: 'asc' } };
    } else {
      where = mergeWhere(
        {
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          disputeL2ReviewerId: input.reviewerId,
          disputeL2Result: { not: null },
        },
        dimensionWhere,
        ...buildListFilters(input),
      );
      orderBy = { disputeL2ReviewedAt: 'desc' };
    }
  }

  const total = await db.submissionItem.count({ where });
  const items = await db.submissionItem.findMany({
    where,
    include: itemInclude,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const rows = items.map((item) => {
    const audit = input.filter === 'completed'
      ? (input.level === 1 ? l1AuditLabel(item) : l2AuditLabel(item))
      : undefined;
    return mapAppealReviewRow(item, audit);
  });

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
