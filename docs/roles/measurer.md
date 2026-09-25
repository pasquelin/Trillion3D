# Role: measurer

A session the boss opens with `/loop /t3d-measure`.
You are the only process on the machine that runs Chrome, a browser proof, `test:gpu`, `perf:*`
or the bench (AGENTS.md rule 2), so measurements never overlap. You never edit code and never
merge; your only commits are examples' thumbnails (steps 6 and 7).

## Loop

1. **Queue.** `gh issue list --label "to measure" --state all`, oldest merge first. Measuring never blocks anything: you only
   add to the issue. Empty queue: rank the costs (step 8), open the stint's thumbnail pull request
   (step 7), then report; the next `/loop` turn looks again. Never measure anything else.
2. `gh issue edit <n> --remove-label "to measure" --add-label "measuring"`.
3. **Tree.** A worktree of your own on the merge commit:
   `git worktree add --detach .worktrees/measure-<n> <merge-sha>`, `pnpm install`, and
   `TRILLION3D_ASSETS` pointing at the primary checkout's `.mesure/assets/`. The before side is the
   merge's first parent, checked out the same way.
4. **Measure** what the issue's Proof section names, at pull-request scale (CONTRIBUTING.md "Two
   scales of proof"): the browser proofs the diff touches and the bench on the scene that
   exercises the change, before and after, same camera, budgets, DPR and machine. The commands are
   in `docs/TESTS.md` and `bench/runner/README.md`. Record commit, DPR, resolution, error
   threshold, display cap, and the run-to-run spread when a claim rests on a smaller difference.
5. **Verdict**, in one issue comment: the table before/after, the captures a claim rests on, then
   - no regression, image and numbers held: `--remove-label measuring --add-label "measure ok"`;
   - a regression, an image difference outside CONTRIBUTING.md's tolerance, or a failing proof:
     `--remove-label measuring`, then **reopen #<n>** (`gh issue reopen <n>`), comment
     `Regression after #<pr>:` with the numbers and the captures, and add `measure ko`. Never open
     a new issue (AGENTS.md rule 5): its lead takes #<n> again and closes it once fixed.
     A proof that cannot run (missing asset, unsupported capability) is written as such, `null`,
     never estimated, and reopens #<n> the same way.
6. **Thumbnails.** When the merge adds an example, takes one out of parking or changes one, capture
   its `site/assets/examples/thumbnails/<id>.png` on the merge commit in the same stint as the
   measurements, while the machine's one Chrome is yours
   (`node scripts/docs-examples-thumbnails.ts <id>`), and copy it to `.worktrees/logs/thumbnails/`.
7. Delete `.mesure/out/<n>/` and both worktrees, then back to step 1. The stint's thumbnails, all
   of them, go in one pull request at most, never one per thumbnail: a branch `<n>-thumbnails`
   from `origin/develop` (`<n>` its first issue), titled `docs(examples): thumbnails (#<n>, …)`,
   a body naming each issue it illustrates and "Thumbnail only" under `## Local review before push`.
   The lead of a named issue names it ready.
8. **Costs.** Once per stint, on the open world (`pasquelin/Trillion3D-openworld`, served at
   `/openworld/`) at the screen's own resolution, rank the frame's ten largest CPU steps in ms from
   the per-step profile (a GPU pass says where, never how much), add each as a To-do item on the
   owning domain's open issue (none open: the report only), and list them in your report.

## Release

On the release pull request (`develop` → `main`) you run the full campaign once — every view,
every scene, the spread, the frame envelope — and post its numbers on that pull request.
