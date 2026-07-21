# Repository Guidelines

Agent tool-usage conventions live here. Project architecture and business
boundaries are in `CLAUDE.md` and `GEMINI.md` — don't duplicate them.

## Build, Test, and Development Commands

```bash
pnpm install                         # install dependencies
pnpm dev                             # Next.js dev server (localhost:3000)
pnpm build                           # production build
pnpm start                           # run built app
pnpm lint                            # ESLint (extends next/core-web-vitals)
pnpm test                            # node:test via tsx (src/lib/*.test.ts)
pnpm prisma:migrate                  # run Prisma migrations
pnpm prisma:generate                 # regenerate Prisma Client
pnpm prisma:seed                     # seed development data
pnpm prisma:studio                   # Prisma Studio GUI

# Data import/export pipeline scripts
pnpm compute:imported-scores         # compute scores from imported data
pnpm export:imported-scores          # export computed scores to XLSX
pnpm seed:scoring-rules              # seed scoring rule templates
pnpm generate:quantitative-report    # generate quantitative report (2026 data layout)
pnpm migrate:2026                    # 2026 annual data migration (multi-step)
```

PostgreSQL and MinIO are required locally. Keep `.env` aligned with
`.env.example`.

## Project Structure (non-obvious)

- `src/app/api/**/route.ts` is the backend surface. Route Handlers validate
  input with Zod and return `{ success, ...data }` or `{ error }` with status.
- `src/lib/` holds ~60 server/domain modules: auth, Prisma, MinIO, notify,
  scoring, imports, facts, pre-review, exports, and dimension registries.
  22 colocated `*.test.ts` files cover the pure business logic.
- `src/components/` has shared UI (admin nav buttons, radar charts, template
  preview); most page-specific UI remains inline in page files.
- `prisma/schema.prisma` is the database contract.
- `scripts/` has import pipelines, scoring computation, report generation,
  seeding helpers, and deploy tooling.
- `types/` holds ambient declarations (e.g., `sentry.d.ts`).
- Sentry config files: `sentry.client.config.ts`, `sentry.server.config.ts`,
  `sentry.edge.config.ts`, `instrumentation.ts`.

## Coding Style & Naming Conventions

- TypeScript `strict: true`, path alias `@/*` → `./src/*`.
- ESLint extends `next/core-web-vitals`; no custom Prettier config.
- API inputs validated with Zod. Auth guarded with `getSession` / `requireRole`
  from `src/lib/auth.ts` at the top of each protected handler.
- Prisma singleton from `src/lib/prisma.ts` (avoids hot-reload duplication).
- UI is Tailwind utility classes; match existing inline style.

## Testing Guidelines

Tests use Node's built-in runner via `tsx`, colocated as `src/lib/*.test.ts`.
Run a single file: `npx tsx --test src/lib/scoring-engine.test.ts`. Route/UI
changes should pass `pnpm lint` and `pnpm build`.

## Business Rules to Preserve

- `NotifyConfig` and `AuthConfig` are singleton records (id=1).
- L1 reviewers are branch-scoped; L2 reviewers are head-office final review.
- Rejected items become editable while approved items stay locked.
- L2 approval writes a `PerformanceRecord.archivedData` JSON snapshot — do not
  replace snapshot semantics with live joins.
- Declaration header fields (work area, tenure, level, specialty) are
  submission-time snapshots.
- MinIO server access uses `127.0.0.1`; browser presigned URLs use
  `MINIO_PUBLIC_*` variables.
- **Fact writes must go through the batch-replace seam** — see
  [`docs/agents/fact-import-conventions.md`](./docs/agents/fact-import-conventions.md).
  Never call `prisma.performanceFact.create/upsert` or
  `prisma.employeeBasicFact.create/upsert` directly in business code;
  use `replaceFactsBySource` / `replaceBasicFactsBySource` instead.
  The only exception is `fact-corrections/route.ts` (appeal audit, single-row).

## Commit & Pull Request Guidelines

Conventional Commits with optional scope: `feat(import):`, `fix(import):`,
`refactor(import):`, `chore(import):`, `docs(plan):`. One behavioral change
per commit. Issues live in GitHub issues for `waynewhzhang-byte/perf-app`;
label vocabulary in `docs/agents/triage-labels.md`.

## Agent Tooling (CodeGraph)

This repo is indexed under `.codegraph/`. Use codegraph for structural
questions — definitions, callers, callees, impact analysis, and flow tracing.
Query with concrete symbols: `persistSubmissionDimensionFacts`,
`SubmissionOptionReview`, `prisma/schema.prisma`.

For whole-project orientation, read `CLAUDE.md`, `GEMINI.md`, and `README.md`
first. For literal text, logs, or error messages, use native grep (`rg`).

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
