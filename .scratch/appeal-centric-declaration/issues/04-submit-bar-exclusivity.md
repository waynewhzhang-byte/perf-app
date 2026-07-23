# 04 — Employee UI: 确认报名 / 提交审核 exclusivity

**What to build:** Bottom bar enforces mutual exclusion — no appeals → only 确认报名 (AFFIRM); saved appeals → only 提交审核 (APPEAL) after save — each with a mis-tap confirmation dialog.

**Blocked by:** 02 — Domain: no-appeal auto L1+L2 archive; 03 — Employee UI: read-only sheet + appeal modal

**Status:** done

- [x] 提交审核 grey when no saved appeals
- [x] 确认报名 disabled when any saved appeal exists
- [x] Clearing all appeals restores AFFIRM-only path
- [x] Confirm dialogs on both completion actions
- [x] API called with correct submit mode
