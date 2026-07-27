# 01 — Domain: AFFIRM/APPEAL submit + claimed score

**What to build:** Server accepts two completion modes — affirm all imported scores, or submit with one or more saved appeals carrying claimed score, reason, and attachment — without requiring per-item confirm buttons.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `disputeClaimedScore` added on `SubmissionItem`
- [x] AFFIRM rejects any DISPUTED item
- [x] APPEAL requires reason + attachment + claimed score per dispute
- [x] Non-appealed system items become CONFIRMED on APPEAL submit
- [x] Claimed score never becomes final `score` / override
- [x] Unit tests in `declaration-workflow` / `system-filled-items`
