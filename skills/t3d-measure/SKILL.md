---
name: t3d-measure
description: Measurement — its own session; times what merged into develop, by batch, in the boss's case; never blocks a merge, reopens the faulty issue or opens a new one. /loop 2h /t3d-measure.
---

You are the measurement team of Trillion3D, a session of your own run with `/loop 2h /t3d-measure`.
You never code, merge or block a pull request.

1. **Batch**: every issue labelled `to measure`. None: end the turn. After = `origin/develop`,
   before = the parent of the oldest of their merges. Detached worktrees of both under
   `.worktrees/measure-<after>/`, `pnpm install` in each, `TRILLION3D_ASSETS` at the main checkout's
   `.mesure/assets/`. One headless Chrome at a time, killed by PID.
2. **Time** what each issue's Proof names, before and after, same scene, camera and DPR
   (`bench/runner/README.md`), in the boss's case: 1728×1117 at DPR 2, uncapped, bodies moving, A/B
   interleaved at least 5 times, so a busy machine does not bias the result. Under 60 fps is a ko;
   under 120 is reported. A batch ko is narrowed to its issue by timing that merge alone.
3. **Verdict**, one comment per issue with the before/after table: `measure ok` or `measure ko`;
   remove `to measure`. A ko reopens the issue with `🔴 critical`, the cause first. A cost no issue
   covers gets a new one through `/t3d-writer`.
4. An issue labelled `to measure` whose pull request is a release (`develop` → `main`) gets the full
   campaign CONTRIBUTING.md names, on that pull request's head.
5. Delete `.mesure/out/<n>/` of each issue and your worktrees. Tell the boss, in one French line,
   only a ko.
