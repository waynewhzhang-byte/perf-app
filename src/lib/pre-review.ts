export interface PreReviewRule {
  id: string;
  name: string;
  enabled: boolean;
  minWorkYears: number | null;
  maxWorkYears: number | null;
  allowedLevelIds: string[];
  rejectMessage: string;
}

export interface PreReviewInput {
  workYears: number;
  declarationLevelId: string;
  rules: PreReviewRule[];
}

export interface PreReviewResult {
  passed: boolean;
  messages: string[];
  matchedRuleIds: string[];
}

export function calculateFullWorkYears(hireDate: Date, asOf: Date): number {
  let years = asOf.getFullYear() - hireDate.getFullYear();
  const asOfMonth = asOf.getMonth();
  const hireMonth = hireDate.getMonth();
  const beforeAnniversary =
    asOfMonth < hireMonth ||
    (asOfMonth === hireMonth && asOf.getDate() < hireDate.getDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

function matchesWorkYearRange(rule: PreReviewRule, workYears: number): boolean {
  if (rule.minWorkYears != null && workYears < rule.minWorkYears) return false;
  if (rule.maxWorkYears != null && workYears >= rule.maxWorkYears) return false;
  return true;
}

export function evaluatePreReviewRules(input: PreReviewInput): PreReviewResult {
  const messages: string[] = [];
  const matchedRuleIds: string[] = [];

  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    if (!matchesWorkYearRange(rule, input.workYears)) continue;
    if (rule.allowedLevelIds.includes(input.declarationLevelId)) continue;
    matchedRuleIds.push(rule.id);
    messages.push(rule.rejectMessage || `${rule.name}未通过`);
  }

  return {
    passed: messages.length === 0,
    messages,
    matchedRuleIds,
  };
}
