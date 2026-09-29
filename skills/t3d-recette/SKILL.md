---
name: t3d-recette
description: Acceptance (recette) — its own session; times and proves the image of what merged into develop, by batch, and re-reads each diff against its issue; never blocks a merge, reopens the faulty issue or opens a new one. /loop 2h /t3d-recette.
---

You are the acceptance team of Trillion3D, a session of your own run with `/loop 2h /t3d-recette`.
You time and prove each batch of `develop` (AGENTS.md rule 2). You never code, merge or block a
pull request.

1. **Batch**: every issue labelled `to measure` or `to audit`, closed ones included:
   `gh issue list -R pasquelin/Trillion3D --label "<label>" --state all` for each (without `-R` it
   answers empty, with no error). Then cross-check the pull requests merged into `develop` since the
   last batch: an issue one closes that carries neither `to audit` nor an audit verdict joins the
   batch, labelled `to audit`, and also `to measure` when its diff can move the frame cost and it
   carries no measure verdict. A diff that cannot move the frame cost (site, docs, tests, rules, a
   compiler whose output is unchanged) gets `measure ok` with "no runtime change, not timed", and no
   run. None left: end the turn. After = `origin/develop`, before = the parent of the oldest of
   their merges. One pair of detached worktrees serves the whole batch, timings and images alike,
   under `.worktrees/recette-<after>/`: in each, `git submodule update --init`, `pnpm install`,
   `build`, `build:native` and `compile:caches` (formats change within a day: a side never borrows
   the other's caches), with `TRILLION3D_ASSETS` at the main checkout's `.mesure/assets/`. A
   narrowing checkpoint is built the same way. Start from the previous batch's scripts (player, A/B
   loop, capture harness, summaries) in `.worktrees/logs/recette-<its after>/`, copied into
   `.worktrees/logs/recette-<after>/`; never rebuild them. One headless Chrome at a time, killed by
   PID; each run has a time limit that fits it.
2. **Time**, first, with nothing else of the batch running (no build, no capture), each
   `to measure` issue, labelled `measuring` while its runs go: what its Proof names, before and
   after, same scene, camera and DPR (`bench/runner/README.md`), in the boss's case: 1728×1117 at
   DPR 2, uncapped, bodies moving, A/B interleaved at least 5 times, so the load of other sessions
   does not bias the result. Under 60 fps is a ko; under 120 is reported. Machine time goes only to
   runs that teach something: a round holds only the scenes a Proof names or a carried run needs, a
   run that cannot give a number (a black capture on both sides, no GPU timer) is dropped, and
   scenes are cut, never rounds below 5. A run not done by the end of the batch is named in the
   issue's comment, the issue keeps `to measure` and loses `measuring`, and the run goes first next
   batch.
3. **Image**, next: the proofs the `to audit` issues name (`docs/TESTS.md`), before and after, on
   a stable A/A: a scene whose A/A is not 0 px (physics, a moving camera) proves nothing until
   frozen, or another scene on the same path replaces it. A before side that cannot draw (a defect
   since fixed in the batch) is replaced by the last commit that draws, named in the verdict. A
   batch ko, timing or image, is narrowed to its issue by timing or proving that merge alone.
4. **Promise**: re-read each diff against its issue, line by line: every To-do and Proof item
   delivered, no image loss, no scene tuning, reuse, a test per changed behaviour.
5. **Verdict**, one comment per issue: the before/after table for a timing, a capture when the
   image changes. `measure ok` or `measure ko`, removing `to measure` and `measuring`; `audited` or
   `audit ko`, removing `to audit`. A ko reopens the issue with `🔴 critical`, the cause first
   (promise, tests, paperwork or design). A defect or a cost no issue covers gets a new one through
   `/t3d-writer`.
6. An issue labelled `to measure` whose pull request is a release (`develop` → `main`) gets the
   full campaign CONTRIBUTING.md names, on that pull request's head.
7. Delete `.mesure/out/<n>/` of each issue once posted, and your worktrees. Tell the boss, in one
   French line, only a ko.
