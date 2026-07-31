import {
  declarationLevelNameCandidates,
  effectiveHireDate,
  evaluationCutoffDate,
  levelFromHireDate,
} from '@/lib/declaration-level';
import { calculateFullWorkYears } from '@/lib/pre-review';

export interface SubmissionDeclarationHeaderSnapshot {
  hireDate?: Date | null;
  workYears?: number | null;
  declarationLevelId?: string | null;
  declarationLevelName?: string | null;
}

export interface UserDeclarationHeaderSource {
  hireDate?: Date | null;
  profile?: unknown;
}

export interface DeclarationLevelOption {
  id: string;
  name: string;
}

/** 申报快照缺失时，从员工档案与能级字典回退补齐表头字段（只读展示/审计用）。 */
export function resolveSubmissionDeclarationHeader(
  submission: SubmissionDeclarationHeaderSnapshot,
  user: UserDeclarationHeaderSource,
  templateYear: number,
  declarationLevels: DeclarationLevelOption[] = [],
): Required<SubmissionDeclarationHeaderSnapshot> {
  const hireDate = submission.hireDate ?? effectiveHireDate(user.hireDate, user.profile);
  const workYears = submission.workYears ?? (
    hireDate ? calculateFullWorkYears(hireDate, evaluationCutoffDate(templateYear)) : null
  );

  let declarationLevelId = submission.declarationLevelId ?? null;
  let declarationLevelName = submission.declarationLevelName ?? null;
  if (!declarationLevelName && hireDate && declarationLevels.length > 0) {
    const inferred = levelFromHireDate(hireDate, evaluationCutoffDate(templateYear));
    const level = declarationLevels.find((candidate) =>
      declarationLevelNameCandidates(inferred).includes(candidate.name),
    );
    if (level) {
      declarationLevelId = level.id;
      declarationLevelName = level.name;
    }
  }

  return {
    hireDate,
    workYears,
    declarationLevelId,
    declarationLevelName,
  };
}
