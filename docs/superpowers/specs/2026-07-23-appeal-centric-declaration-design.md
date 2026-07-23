# Spec: 申诉中心化申报与审核改造

**Origin:** `docs/brainstorms/2026-07-23-申报系统修改需求.md`  
**Date:** 2026-07-23  
**Status:** draft-for-tickets  
**Ask-matt route:** multi-session → to-spec → to-tickets → implement (per ticket)

## Problem Statement

员工现在要对系统导入的每一项积分逐项点「确认/申诉」，审核员也要处理大量无异议申报。业务方要求改为：员工只查看系统分与计算过程，用底部统一申诉表达异议；无异议则「确认报名」直通终审归档；有申诉才进入一审/二审工作台，并以表格批量处理申诉行。

## Solution

在现有「事实导入 → 系统填分 → confirmationStatus/申诉 → L1/L2」架构上做工作流迁移，而不是换栈：

1. 员工端：只读维度树 + 底部申诉弹窗 + 「确认报名 / 提交审核」互斥提交。
2. 无申诉：提交后自动 L1+L2 通过并写 `PerformanceRecord`，不进待审队列。
3. 有申诉：仅申诉项进审核；工作台改为申诉行表格（筛选/批量），权限仍按工区/部门 scope。
4. 申诉分值为员工主张分（展示与审核参考），最终分仍走事实修正，不恢复 override API。

## Provisional Product Decisions（规划默认，可推翻）

来自 2026-07-23 doc-review；实施前若业务另有决定，先改本规格再开 ticket。

| ID | 决策 | 默认 |
|----|------|------|
| D1 | 蓝框 | **已确认**：保留并改文案（只读核对 + 底部申诉 + 确认无异议）；废弃「删蓝框」 |
| D2 | 说明文案 | **已确认**：去掉「逐项确认」措辞，与只读 + 申诉 + 确认无异议一致 |
| D3 | 申诉分值 / 审结 | **已确认**：主张分不改最终分；审核确认=理由成立；审结后按当时系统分归档（不因待事实修正而阻断） |
| D4 | 无申诉路径 | **已确认（grill A）**：确认无异议 → 跳过待审 → 直通归档 PerformanceRecord；有申诉时亦只审申诉行（ADR-0008） |
| D5 | 申诉可见与路由 | **已确认**：L1=申报人工区 scope；L2=维度二审归属部门；「所有申诉」=该人在本 scope 内的申诉行 |
| D6 | 申诉 UI / 保存 | **已确认**：弹窗；多条；叶级级联；保存=草稿落库（未送审）；提交前可删改 |
| D7 | 双 CTA | 保留「确认报名」与「提交审核」互斥（不做单按钮合并） |
| D8 | 交付切分 | P0=R3+R4+R5+R7；P1=R8；P2=R1/R1b/R1c/R2/R6 |
| D9 | 计算过程 | 复用 `fact-derivation` / score sheet，不新建引擎 |
| D11 | 申诉驳回范围 | **已确认**：任一申诉驳回 → 整单 REJECTED 退回（沿用驳回重提）；不做行级并行驳回 |

## User Stories

1. As an employee, I want a read-only view of imported scores by dimension, so that I can verify without inventing scores.
2. As an employee, I want to see calculation process for tertiary items, so that I know why a score was given.
3. As an employee, I want one bottom Appeal entry with cascading item pick, claimed score, reason, and mandatory attachment, so that I can dispute only wrong items.
4. As an employee, I want to save multiple appeals and delete them before final submit, so that I can change my mind.
5. As an employee with no appeals, I want「确认报名」with a confirm dialog, so that I accept all system scores without review queue.
6. As an employee with saved appeals, I want「提交审核」enabled only after save, so that appeals reach the correct L1/L2 desks.
7. As an L1 reviewer, I want to see only appeal rows in my work-area scope as a table, so that I do not review non-appealed scores.
8. As an L2 reviewer, I want to see appeal rows after L1 for my department scope, so that I finalize disputes.
9. As a reviewer, I want filter, keyword search, batch confirm/reject, and attachment preview, so that I can process appeals efficiently.
10. As an employee after reject, I want rejected appeals editable again, so that I can re-submit.
11. As an admin (P2), I want editable support phone and notice text, so that ops can update without deploy.
12. As compliance (P2), I want a forced-read notice before declaration, so that confidentiality expectations are shown.

## Implementation Decisions

- **Reuse, don’t replace:** keep `SubmissionItem.confirmationStatus` (`CONFIRMED` / `DISPUTED`), `disputeReason`, attachments, L1/L2 dispute fields. Retire per-item confirm/appeal **UI**; server accepts submission-level affirm path.
- **Schema add:** `disputeClaimedScore Decimal?` on `SubmissionItem` (主张分). Do not re-enable `/api/admin/override` (stays 410).
- **Submit modes:** extend declaration command with `submitMode: 'AFFIRM' | 'APPEAL'` (or equivalent). AFFIRM requires zero DISPUTED items and marks all system items CONFIRMED then finalizes L1+L2+archive. APPEAL requires ≥1 saved DISPUTED with reason+attachment+claimed score.
- **Auto-finalize:** AFFIRM 复用 `finalizeArchive` / `buildArchivedSnapshot`（ADR-0002）；允许由 `declaration-workflow` 在确认无异议路径调用，不另造快照格式。系统填充维度不再为无申诉项生成 L2 `SubmissionOptionReview` 待办（ADR-0008）。
- **Review list API:** return flat appeal rows (not whole submission cards) filtered by reviewer scope; enforce scope server-side on list, detail, attachment preview, and batch actions.
- **UI surfaces:** employee submission page; review page table rewrite; optional admin config pages in P2.
- **Copy/config:** template title/description via existing template fields (R1b); hire date / level display already on submission snapshot (R1c).

## Testing Decisions

- Prefer pure unit tests at `src/lib/*.test.ts` seams: declaration submit modes, auto-finalize, review list filtering, batch dispute decisions.
- Characterization tests for existing confirm/dispute paths before changing `systemFilledSubmitError` / `systemItemStatusOnSubmit`.
- UI: smoke via manual checklist; no new E2E required for P0 unless existing Playwright harness is already green for review.

## Out of Scope

- Reopening override-score admin API
- New scoring/calculation engine
- Changing import/fact pipeline itself
- Mobile redesign beyond usable bottom bar
- Full CMS for notices beyond simple singleton config (P2 minimum)

## Further Notes

- Atomic release: do not enable R3 without R4+R5+R7 in production.
- **Grill settled (2026-07-23):** 只审申诉；确认≠改分；审结即按系统分归档；L1/L2 路由沿用现网；整单驳回；申诉保存=草稿；保留蓝框新文案。见 D1–D6、D11 与 ADR-0008。
- Residual for later grill/P2: R1 弹窗频率与是否落库确认、R6/R1 管理端可编辑细节、手工填写维度是否仍走 ADR-0005。
