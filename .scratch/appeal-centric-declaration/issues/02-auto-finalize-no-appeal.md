# 02 — Domain: no-appeal auto L1+L2 archive

**What to build:** Affirming with no appeals finalizes the declaration through both review levels and writes the PerformanceRecord archive, without placing the submission in any reviewer pending queue.

**Blocked by:** 01 — Domain: AFFIRM/APPEAL submit + claimed score

**Status:** done

- [x] AFFIRM ends in L2-approved (or equivalent final) state
- [x] PerformanceRecord snapshot written via existing archive path (ADR-0002)
- [x] AFFIRM submissions absent from pending review list
- [x] APPEAL submissions enqueue only disputed items for L1
- [x] Unit tests cover finalize vs enqueue
