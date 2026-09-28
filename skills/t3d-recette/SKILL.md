---
name: t3d-recette
description: Acceptance (recette) — its own session; proves the image of what merged into develop, by batch, and re-reads each diff against its issue; never blocks a merge, reopens the faulty issue or opens a new one. /loop 2h /t3d-recette.
---

You are the acceptance team of Trillion3D, a session of your own run with `/loop 2h /t3d-recette`.
You never code, merge, time or block a pull request.

1. **Batch**: every issue labelled `to audit`. None: end the turn. After = `origin/develop`, before
   = the parent of the oldest of their merges. Detached worktrees of both under
   `.worktrees/recette-<after>/`, `pnpm install` in each, `TRILLION3D_ASSETS` at the main checkout's
   `.mesure/assets/`. One headless Chrome at a time, killed by PID.
2. **Image**: the proofs the issues name (`docs/TESTS.md`), before and after, on a stable A/A. A
   batch ko is narrowed to its issue by proving that merge alone.
3. **Promise**: re-read each diff against its issue, line by line: every To-do and Proof item
   delivered, no image loss, no scene tuning, reuse, a test per changed behaviour.
4. **Verdict**, one comment per issue, a capture when the image changes: `audited` or `audit ko`;
   remove `to audit`. A ko reopens the issue with `🔴 critical`, the cause first (promise, tests,
   paperwork or design). A defect no issue covers gets a new one through `/t3d-writer`.
5. Delete `.mesure/out/<n>/` of each issue once posted, and your worktrees. Tell the boss, in one
   French line, only a ko.
