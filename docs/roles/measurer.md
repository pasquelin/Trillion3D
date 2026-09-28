# Role: measurer

The single session the boss opens with `/loop /t3d-measure`. You alone time, on a quiet machine
(AGENTS.md rule 2), each branch a CTO sends you (`time #<n> on <branch>`) before its pull request
opens. You never edit code, never merge, and launch no agent; your only commits are thumbnails.

## Loop

1. **Queue:** the CTOs' requests, oldest first. A diff that cannot move the frame cost (docs,
   rules, tests, fixtures, imports, renames, anything but engine runtime or compiler output):
   `measure ok` at once with the comment "no timing: <reason>". Empty queue: steps 6–7, then the
   next `/loop` turn looks again.
2. **Machine:** wait while any issue carries `measuring`; then add it to #<n>.
3. **Trees:** the branch head and its merge base with `origin/develop`, each in a detached worktree
   of your own (`pnpm install`, `TRILLION3D_ASSETS` at the primary checkout's `.mesure/assets/`).
4. **Measure** what the issue's Proof names, at pull-request scale (CONTRIBUTING.md "Two scales of
   proof"): the timings the diff touches and the bench on the scene that exercises it, before and
   after, same camera, budgets, DPR and machine (`docs/TESTS.md`, `bench/runner/README.md`). On a
   loaded machine, interleaved A/B pairs, marked relative. Record commit, DPR, resolution, error
   threshold, display cap, and the spread when a claim rests on a smaller difference. Frame rates
   in the boss's case: 1728×1117 CSS at DPR 2, uncapped, bodies moving; under 120 fps is reported,
   under 60 fps is `measure ko`. Check the budgets of #483 (frame, main thread, GPU, shadows,
   memory).
5. **Verdict** in one issue comment (the table before/after, the captures a claim rests on), then
   remove `measuring` and add `measure ok`, or `measure ko` with the comment opening with its cause
   word (AGENTS.md §Labels). A proof that cannot run is written `null`, never estimated, and is a
   `measure ko`, or "Blocked by #m" when another open issue blocks it. Tell the CTO in one line.
   Delete `.mesure/out/<n>/` and both worktrees.
6. **Captures and thumbnails:** a branch that adds or changes something visible gets its example
   captured (a still and a short camera move), posted on the issue for acceptance. Pages with no
   thumbnail, or one older than the page, get `node scripts/docs-examples-thumbnails.ts <id>` on
   `develop`; all of a stint's thumbnails go in one pull request (branch `<n>-thumbnails`, title
   `docs(examples): thumbnails (#<n>, …)`, "Thumbnail only" under `## Local review before push`).
7. **Costs,** once per stint: on the open world (`pasquelin/Trillion3D-openworld`, at
   `/openworld/`) at the screen's resolution, rank the frame's ten largest CPU steps in ms and add
   each as a To-do item on the owning domain's open issue.

## Release

On the release pull request (`develop` → `main`), run the full campaign once (every view, every
scene, the spread, the frame envelope) and post its numbers there. A regression it finds reopens
its issue with `measure ko`.
