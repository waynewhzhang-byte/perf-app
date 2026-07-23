# 申诉中心化申报改造 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or Matt `/implement` per ticket) to implement task-by-task. Prefer CodeGraph (`codegraph_explore`) before Grep/Read when exploring source.

**Goal:** 将员工申报从「逐项确认/申诉」迁移为「只读核对 + 底部统一申诉 + 无异议直通终审」，审核台只处理申诉行。

**Architecture:** 复用 `confirmationStatus` / dispute 字段与 `declaration-workflow` / `review-workflow`；扩展提交模式（AFFIRM vs APPEAL）与主张分；无申诉路径复用既有归档快照；审核 API/UI 改为申诉行表格并强制 scope。

**Tech Stack:** Next.js 14 App Router, Prisma/PostgreSQL, MinIO attachments, Zod, colocated `src/lib/*.test.ts` (tsx node:test)

**Origin:** `docs/brainstorms/2026-07-23-申报系统修改需求.md`  
**Spec:** `docs/superpowers/specs/2026-07-23-appeal-centric-declaration-design.md`  
**ADR:** `docs/adr/0008-appeal-only-review-for-system-filled.md`  
**Grill:** 2026-07-23 已达成共享理解（只审申诉；确认≠改分；审结即归档系统分；L1/L2 路由沿用现网；整单驳回；申诉保存=草稿；保留蓝框新文案）

---

## Settled decisions (do not re-litigate in implement)

| ID | Decision |
|----|----------|
| G1 | 系统填充维度只审申诉；无异议 AFFIRM 直通归档（ADR-0008） |
| G2 | 审核「确认」= 理由成立；主张分不改最终分；改数走事实修正 |
| G3 | 申诉审结后按当时系统分归档，不因待事实修正阻断 |
| G4 | L1=申报人工区；L2=维度二审归属部门 |
| G5 | 任一申诉驳回 → 整单 REJECTED（驳回重提） |
| G6 | 申诉「保存」= 草稿落库；「提交审核」才进队列 |
| G7 | 保留蓝框并改文案；领域词用「确认无异议」（UI 可写确认报名） |
## Scope & sequencing

| Phase | Tickets | Requirements |
|-------|---------|--------------|
| P0 MVP | T01–T04 | R3+R4+R5+R7 |
| P1 | T05 | R8 |
| P2 | T06–T07 | R1/R1b/R1c/R2/R6 |

**Do not ship** R3 alone in production.

---

## Key code anchors (follow these)

| Area | Paths |
|------|--------|
| Submit / confirm-dispute rules | `src/lib/declaration-workflow.ts`, `src/lib/system-filled-items.ts` |
| L1/L2 + dispute + archive | `src/lib/review-workflow.ts` |
| Score derivation display | `src/lib/fact-derivation.ts`, `src/lib/performance-score-sheet.ts` |
| Employee UI | `src/app/app/submission/[templateId]/page.tsx` |
| Review UI / API | `src/app/app/review/page.tsx`, `src/app/api/review/route.ts` |
| Schema | `prisma/schema.prisma` → `SubmissionItem` |
| Tests | `src/lib/declaration-workflow.test.ts`, `src/lib/review-workflow.test.ts`, `src/lib/system-filled-items.test.ts` |

---

## Task map (implementation units)

### T01 — Domain: submit modes + claimed score + retire per-item gate

**Files:**
- Modify: `prisma/schema.prisma` (add `disputeClaimedScore`)
- Modify: `src/lib/system-filled-items.ts`, `src/lib/declaration-workflow.ts`
- Test: `src/lib/system-filled-items.test.ts`, `src/lib/declaration-workflow.test.ts`

**Approach:**
1. Add nullable `disputeClaimedScore Decimal?`.
2. Introduce submission-level validation:
   - AFFIRM: no DISPUTED items; all system items become CONFIRMED; then auto-finalize (see T02).
   - APPEAL: each DISPUTED needs reason + attachment + claimed score; non-disputed system items CONFIRMED.
3. Replace “每项必须选确认或申诉” gate for the new UI path; keep characterization tests for old helper behavior during transition.
4. Persist claimed score; never write it into final `score` / override.

**Test scenarios:**
- AFFIRM with any DISPUTED → error
- APPEAL without attachment/reason/claimed score → error
- APPEAL marks non-appealed system items CONFIRMED and appealed PENDING path

---

### T02 — Domain: no-appeal auto L1+L2 + PerformanceRecord

**Files:**
- Modify: `src/lib/declaration-workflow.ts` and/or `src/lib/review-workflow.ts`
- Test: `src/lib/declaration-workflow.test.ts`, `src/lib/review-workflow.test.ts`

**Approach:**
- On AFFIRM success: submission status → `L2_APPROVED` (or equivalent final), write archive snapshot via existing archive helper (ADR-0002), do **not** enqueue for review list.
- Emit review logs as system/auto actions if logs are required for audit.
- APPEAL submit: only disputed items enter L1 queue; confirmed items skipped (`isReviewSkippedSystemItem`).

**Test scenarios:**
- AFFIRM creates PerformanceRecord and never appears in pending review filter
- APPEAL appears in L1 pending with only disputed items

---

### T03 — Employee UI: read-only sheet + bottom appeal modal

**Files:**
- Modify: `src/app/app/submission/[templateId]/page.tsx` (and any score-sheet components it uses)
- Possibly extract small helpers under `src/lib/` for cascade options from score sheet

**Approach:**
- Remove per-item 确认/申诉 buttons (R3).
- Show dimension hierarchy; tertiary row shows 评价标准 / 得分 / 计算过程 from existing derivation (D9) — can ship minimal expand/collapse in this ticket or defer polish to T06.
- Bottom「申诉」opens modal: cascade → system score (ro) → claimed score → content → attachment → 保存.
- Allow list/edit/delete saved appeals before submit.
- Green styling: all green on AFFIRM; non-appealed green + appeal-pending style when appeals exist.

**Manual check:**
- Save two appeals, delete one, reload page, state intact

---

### T04 — Employee UI: 确认报名 / 提交审核 mutual exclusion

**Files:**
- Modify: submission page + `src/app/api/submissions/route.ts` payload shape
- Test: declaration-workflow tests cover server; UI manual

**Approach:**
- No saved appeals → 提交审核 disabled; 确认报名 → confirm dialog → AFFIRM.
- Has saved appeals → 确认报名 disabled; after save → 提交审核 → confirm dialog → APPEAL.
- Clearing all appeals returns to AFFIRM-only path.

**Manual check:**
- Mis-tap prevention dialogs; button grey states

---

### T05 — Reviewer: appeal-row table + filters + batch (R8)

**Files:**
- Modify: `src/app/api/review/route.ts`, `src/app/app/review/page.tsx`
- Test: review-workflow / new API-level tests if pure helpers extracted

**Approach:**
- Keep pending/completed tabs.
- Main pane: table columns per R8; row = one appeal item.
- Filters: 申诉项 + keyword; batch confirm/reject with notes for reject.
- Scope: L1 work-area / L2 department; 「所有申诉」= that applicant within scope (D5).
- Attachment preview reuses existing `/api/attachments/:id/view` with authz check.
- Completed tab: audit column frozen to 确认/驳回.

**Test scenarios:**
- Out-of-scope appeal never returned
- Batch reject without note rejected by API

---

### T06 — Display polish: title/header/calc process (R1b/R1c/R2)

**Files:**
- Template seed or admin template fields; submission header rendering; derivation UI polish

**Approach:**
- Title/description copy per D1/D2.
- Hire date + level display only (R1c).
- Calc process truncated + expand using `fact-derivation` steps.

---

### T07 — Compliance & ops chrome (R1 notice + R6 phone)

**Files:**
- Login → app gate component; optional `AppConfig`/singleton model; admin edit UI

**Approach:**
- 30s non-dismissible notice (or agreed variant); persist acknowledgment if cheap.
- Support phone footer; admin-editable singleton.
- Admin-editable notice content optional same singleton pattern.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Auto-finalize wrong scores | D4 + import owner; fact-correction remains post-hoc path |
| Dual CTA confusion | Explicit exclusivity + dialogs (T04) |
| Scope leak in table/batch | Server-side id checks (T05) |
| Parallel Appeal model | Forbidden — reuse SubmissionItem dispute fields |

## Verification (whole MVP)

```bash
pnpm test
pnpm lint
# Manual: employee AFFIRM path + APPEAL path + L1/L2 table on sample data
```

## Ticket dependency graph

```text
T01 → T02 → T03 → T04 → (MVP shippable for employee+auto-pass)
                ↘ T05 (review table; can start after T02)
T06, T07 independent after T03 (P2)
```
