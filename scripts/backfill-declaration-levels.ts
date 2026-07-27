#!/usr/bin/env npx tsx
/** 修复自动计算能级未匹配等级字典导致的申报与归档快照缺失。 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  declarationLevelNameCandidates,
  evaluationCutoffDate,
  levelFromHireDate,
} from '@/lib/declaration-level';
import { isFieldEnabled, resolveHeaderFields } from '@/lib/header-fields';

function withDeclarationLevel(
  archivedData: Prisma.JsonValue,
  level: { id: string; name: string },
): Prisma.InputJsonValue | null {
  if (!archivedData || typeof archivedData !== 'object' || Array.isArray(archivedData)) return null;
  const archive = archivedData as Prisma.JsonObject;
  const header = archive.declarationHeader;
  const declarationHeader = header && typeof header === 'object' && !Array.isArray(header)
    ? header as Prisma.JsonObject
    : {};
  if (
    declarationHeader.declarationLevelId === level.id &&
    declarationHeader.declarationLevelName === level.name
  ) {
    return null;
  }
  return {
    ...archive,
    declarationHeader: {
      ...declarationHeader,
      declarationLevelId: level.id,
      declarationLevelName: level.name,
    },
  };
}

async function main() {
  const [levels, submissions] = await Promise.all([
    prisma.declarationLevel.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.submission.findMany({
      where: { hireDate: { not: null } },
      select: {
        id: true,
        hireDate: true,
        declarationLevelId: true,
        declarationLevelName: true,
        template: { select: { year: true, headerFields: true } },
      },
    }),
  ]);
  const records = await prisma.performanceRecord.findMany({
    where: { submissionId: { in: submissions.map((submission) => submission.id) } },
    select: { id: true, submissionId: true, archivedData: true },
  });
  const recordBySubmissionId = new Map(records.map((record) => [record.submissionId, record]));
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  let unresolved = 0;
  let skippedManualLevelTemplates = 0;
  let updatedSubmissions = 0;
  let updatedArchives = 0;

  for (const submission of submissions) {
    if (isFieldEnabled(resolveHeaderFields(submission.template.headerFields), 'declarationLevel')) {
      skippedManualLevelTemplates += 1;
      continue;
    }
    const calculated = levelFromHireDate(submission.hireDate!, evaluationCutoffDate(submission.template.year));
    const level = levels.find((candidate) => declarationLevelNameCandidates(calculated).includes(candidate.name));
    if (!level) {
      unresolved += 1;
      continue;
    }
    if (submission.declarationLevelId !== level.id || submission.declarationLevelName !== level.name) {
      updates.push(prisma.submission.update({
        where: { id: submission.id },
        data: { declarationLevelId: level.id, declarationLevelName: level.name },
      }));
      updatedSubmissions += 1;
    }

    const record = recordBySubmissionId.get(submission.id);
    const archivedData = record && withDeclarationLevel(record.archivedData, level);
    if (record && archivedData) {
      updates.push(prisma.performanceRecord.update({
        where: { id: record.id },
        data: { archivedData },
      }));
      updatedArchives += 1;
    }
  }

  if (updates.length > 0) await prisma.$transaction(updates);
  console.log(JSON.stringify({
    scannedSubmissions: submissions.length,
    updatedSubmissions,
    updatedArchives,
    unresolved,
    skippedManualLevelTemplates,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
