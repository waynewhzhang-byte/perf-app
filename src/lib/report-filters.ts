import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export interface ReportScopeFilters {
  branchIds: string[];
  declarationLevelIds: string[];
  declarationSpecialtyIds: string[];
}

export interface ReportExportFilters extends ReportScopeFilters {
  templateId: string;
}

const ReportScopeFiltersSchema = z.object({
  branchIds: z.array(z.string().trim().min(1).max(128)).max(100),
  declarationLevelIds: z.array(z.string().trim().min(1).max(128)).max(100),
  declarationSpecialtyIds: z.array(z.string().trim().min(1).max(128)).max(100),
});
const ReportTemplateIdSchema = z.string().trim().min(1).max(128);

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function readValues(
  params: URLSearchParams,
  pluralKey: string,
  legacyKey: string,
): string[] {
  const repeated = params.getAll(pluralKey).flatMap((value) => value.split(','));
  const legacy = params.getAll(legacyKey).flatMap((value) => value.split(','));
  return uniqueValues([...repeated, ...legacy]);
}

export function parseReportScopeFilters(params: URLSearchParams): ReportScopeFilters {
  return ReportScopeFiltersSchema.parse({
    branchIds: readValues(params, 'branchIds', 'branchId'),
    declarationLevelIds: readValues(
      params,
      'declarationLevelIds',
      'declarationLevelId',
    ),
    declarationSpecialtyIds: readValues(
      params,
      'declarationSpecialtyIds',
      'declarationSpecialtyId',
    ),
  });
}

export function safeParseReportScopeFilters(params: URLSearchParams):
  | { success: true; data: ReportScopeFilters }
  | { success: false; error: string } {
  const parsed = ReportScopeFiltersSchema.safeParse({
    branchIds: readValues(params, 'branchIds', 'branchId'),
    declarationLevelIds: readValues(
      params,
      'declarationLevelIds',
      'declarationLevelId',
    ),
    declarationSpecialtyIds: readValues(
      params,
      'declarationSpecialtyIds',
      'declarationSpecialtyId',
    ),
  });
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: '报表筛选参数无效' };
}

export function parseReportExportFilters(
  url: URL,
): ReportExportFilters | { error: string } {
  const templateId = ReportTemplateIdSchema.safeParse(
    url.searchParams.get('templateId') ?? undefined,
  );
  if (!templateId.success) return { error: 'templateId 参数无效' };
  const scope = safeParseReportScopeFilters(url.searchParams);
  if (!scope.success) return { error: scope.error };
  return { templateId: templateId.data, ...scope.data };
}

export function hasReportScopeFilters(filters: ReportScopeFilters): boolean {
  return (
    filters.branchIds.length > 0
    || filters.declarationLevelIds.length > 0
    || filters.declarationSpecialtyIds.length > 0
  );
}

export function appendReportScopeFilters(
  params: URLSearchParams,
  filters: ReportScopeFilters,
): URLSearchParams {
  for (const branchId of filters.branchIds) params.append('branchIds', branchId);
  for (const levelId of filters.declarationLevelIds) {
    params.append('declarationLevelIds', levelId);
  }
  for (const specialtyId of filters.declarationSpecialtyIds) {
    params.append('declarationSpecialtyIds', specialtyId);
  }
  return params;
}

export function reportSubmissionScopeWhere(
  filters: ReportScopeFilters,
): Prisma.SubmissionWhereInput {
  const where: Prisma.SubmissionWhereInput = {};
  const and: Prisma.SubmissionWhereInput[] = [];

  if (filters.branchIds.length > 0) {
    and.push({
      OR: [
        { branchId: { in: filters.branchIds } },
        {
          branchId: null,
          user: { branchId: { in: filters.branchIds } },
        },
      ],
    });
  }
  if (filters.declarationLevelIds.length > 0) {
    and.push({ declarationLevelId: { in: filters.declarationLevelIds } });
  }
  if (filters.declarationSpecialtyIds.length > 0) {
    and.push({
      declarationSpecialtyId: { in: filters.declarationSpecialtyIds },
    });
  }
  if (and.length > 0) where.AND = and;
  return where;
}
