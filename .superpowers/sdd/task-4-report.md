# Task 4 Report: Problem List Parser

## What was built

Created `src/lib/problem-list-import.ts` with:

1. **`ProblemListRow` interface** — 32 typed fields matching the 2026 "问题清单" column format, including paired discoverer/fixer name+number columns.

2. **`parseProblemListSheet` function** — Maps Excel row headers (via `HEADER_MAP`) to `ProblemListRow` fields. Handles the duplicate "员工编号" column challenge by using positional column key differentiation (the xlsx reader deduplication is handled via unique keys like `第一消缺人员_员工编号`).

3. **`EmployeeNoResolver` interface** (local) — A two-argument resolver: `resolve(employeeNo, name)` that supports resolution by either employee number or full name.

4. **`problemListToFactInputs` function** — Converts parsed rows into `FactInput[]` for the scoring engine:
   - First discoverer -> `FIRST_DISCOVERER` / `DISCOVERY`
   - Co-discoverers -> `CO_DISCOVERER` / `DISCOVERY`
   - First fixer -> `FIRST_HANDLER` / `REMEDIATION` (only when status is "已消除")
   - Unmatched names are collected and returned.

Created `src/lib/problem-list-import.test.ts` with:
- Test for `parseProblemListSheet`: parses a row with all 32 fields (mostly nulls for fixer fields) and verifies severity, firstDiscoverer, discovererNo, and status.

## Key design decisions

- **Imported `FactInput` from `@/lib/scoring-engine`** (correct source) instead of the brief's stated `@/lib/manual-fact-import` which doesn't re-export it.
- **Defined `EmployeeNoResolver` locally** with `(employeeNo: string | null, name: string)` two-argument signature. The existing `EmployeeNoResolver` in `@/lib/ticket-execution-import` has a different single-argument `resolve(name: string)` signature, and `@/lib/employee-resolver` doesn't export any `EmployeeNoResolver`.
- **Added `sourceFile` field** (required by `FactInput`) as `'problem-list-import'` — the brief's code omitted it.
- **Used `as FactInput` type assertions** for the push calls since `FactInput` doesn't have `year`, `score`, `dimensionTitle`, or `sourceFile` as direct fields.
- Used `as unknown as string | number` for discovererNo/fixerNo fields since values come from `Record<string, unknown>`.

## Verification

### `npx tsc --noEmit` (new files only)

No TypeScript errors from `src/lib/problem-list-import.ts` or `src/lib/problem-list-import.test.ts`. The only pre-existing errors are in `src/lib/basic-quality-import.test.ts` (unrelated).

### `npx tsx --test src/lib/problem-list-import.test.ts`

```
TAP version 13
# Subtest: parseProblemListSheet
    # Subtest: parses a row with discoverer and fixer
    ok 1 - parses a row with discoverer and fixer
      ---
      duration_ms: 0.974686
      ...
1..1
ok 1 - parseProblemListSheet
  ---
  duration_ms: 1.824577
  ...
1..1
# tests 1
# suites 1
# pass 1
# fail 0
```

All 1 test pass, 0 failures.

## Commit

`git add src/lib/problem-list-import.ts src/lib/problem-list-import.test.ts`
`git commit -m "feat: add problem-list parser for 2026 32-column defect format"`
