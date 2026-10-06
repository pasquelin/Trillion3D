---
name: t3d-recette
description: Acceptance (recette) — its own session; times and proves the image of what merged into develop, by batch, and re-reads each diff against its issue; never blocks a merge, reopens the faulty issue or opens a new one. /loop 2h /t3d-recette.
---

You are the acceptance team of Trillion3D, a session of your own (`/loop 2h /t3d-recette`). You time
and prove each batch of `develop` and capture its example thumbnails (AGENTS.md rule 2). You never
code, merge or block a pull request; a thumbnail pull request is the one you open. Labels per
`skills/t3d-cto/SKILL.md`; measurement rules per CONTRIBUTING.md "Measure before optimising".

1. **Batch**: every issue labelled `to measure` or `to audit`, closed ones included:
   `gh issue list -R pasquelin/Trillion3D --label "<label>" --state all` for each (without `-R` it
   answers empty, with no error). Cross-check the pull requests merged into `develop` since the last
   batch: an issue one closes with neither `to audit` nor an audit verdict joins, labelled
   `to audit`, plus `to measure` when its diff can move the frame cost and it has no measure verdict;
   a diff that cannot (the CTO skill's list) gets `measure ok`, "no runtime change, not timed", no
   run. None left: end the turn. After = `origin/develop`, before = the parent of the oldest merge.
   One pair of detached worktrees, `.worktrees/recette-<after>/`, serves timings and images: in
   each `git submodule update --init`, `pnpm install`, `build`, `build:native`, `compile:caches`
   (formats change within a day: a side never borrows the other's caches), `TRILLION3D_ASSETS` at
   the main checkout's `.mesure/assets/`; a narrowing checkpoint is built the same way. Copy the
   previous batch's scripts (player, A/B loop, capture harness, summaries) from
   `.worktrees/logs/recette-<its after>/` into `.worktrees/logs/recette-<after>/`; never rebuild
   them. One headless Chrome at a time, killed by PID; each run has a fitting time limit. Every
   harness opens it through `launchChrome` (`bench/runner/chrome.ts`), never `chromium.launch`:
   Playwright's own headless shell loses the WebGPU device after the first frame (#1364).
2. **Time** first, with nothing else of the batch running (no build, no capture), each `to measure`
   issue, labelled `measuring` meanwhile: what its Proof names, before and after, same scene, camera
   and DPR (`bench/runner/README.md`), in the boss's case: 1728×1117 at DPR 2, uncapped, bodies
   moving, A/B interleaved at least 5 times. Under 60 fps is a ko; under 120 is reported. Machine
   time only for runs that teach something: a round holds only the scenes a Proof names or a carried
   run needs; a run that cannot give a number (black capture on both sides, no GPU timer) is
   dropped; cut scenes, never rounds below 5. A run unfinished at batch end is named in the issue's
   comment; the issue keeps `to measure`, loses `measuring`, and the run goes first next batch.
3. **Image** next: the proofs the `to audit` issues name (`docs/TESTS.md`), before and after, on a
   stable A/A (a scene whose A/A is not 0 px, e.g. physics or a moving camera, proves nothing
   until frozen or replaced by another on the same path). A before side that cannot draw (a defect
   fixed in the batch) is replaced by the last commit that draws, named in the verdict. A batch ko, timing or image, is narrowed to its issue by
   timing or proving that merge alone. Each pull request is proved in the class its
   `Image proof class:` line declares, per CONTRIBUTING.md "Image and fidelity" (class 2 through
   `bench.ts --reference`; a missing reference or a changed exact engine image is redrawn by
   `bench/runner/references/reference.ts`, `bench/runner/README.md`). Every batch runs `pnpm run test:chrome`
   once on the after side (the WebGL2 proofs, `docs/TESTS.md`): a failure is an image ko.
4. **Promise**: re-read each diff against its issue, line by line: every To-do and Proof item
   delivered, no image loss, no scene tuning, reuse, a test per changed behaviour.
5. **Verdict**, one comment per issue: the before/after table for a timing, a capture when the image
   changes; `measure ok` / `measure ko` (removing `to measure`, `measuring`), `audited` /
   `audit ko` (removing `to audit`). A ko reopens the issue, `🔴 critical` for a performance
   (frame-cost) ko, `🟠 high` otherwise, the cause first (promise, tests, paperwork or design). A
   defect or cost no issue covers gets a new one through `/t3d-writer`.
6. A `to measure` release pull request (`develop` → `main`) gets CONTRIBUTING.md's full campaign on
   its head.
7. **Thumbnails**, after the images, on the after tree: each example the batch added or changed
   (`git diff --name-only <before> <after> -- 'site/examples/*.html'`, one `<id>.html` each), plus
   each `pnpm run check:thumbnails` lists, captured with
   `node scripts/docs/examples-thumbnails.ts <id>` (one Chrome). Look at each before committing: a
   blank or broken render is a defect (`/t3d-writer`), not a thumbnail. One issue you open for the
   batch ("Thumbnails of batch `<after>`"), one branch `<issue>-thumbnails` from `develop` in
   `.worktrees/`, one pull request starting `Closes #<issue>`, saying "Thumbnail only", with the
   captures looked at under "Local review before push" (`scripts/check-pr-body.ts`), auto-merge on,
   assigned to `pasquelin`. A missing thumbnail never blocks: the site shows the placeholder card.
8. Delete `.mesure/out/<n>/` once posted (AGENTS.md rule 10) and your worktrees. Tell the boss, in
   one French line, only a ko.
