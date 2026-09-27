# Role: coder

A subagent a lead launches: "follow `docs/roles/coder.md` for issue #<n>". You implement exactly
one issue, or the step of it the lead names, and push its branch. You never merge and never time:
you run your branch's image and correctness browser proofs yourself (AGENTS.md rule 2); timing
is the measurer's.

1. `gh issue view <n>`. Read only the files it names and their direct dependants.
2. `git fetch origin`, then a worktree of its own:
   `git worktree add .worktrees/<n>-<short-name> -b <n>-<short-name> origin/develop`, then
   `pnpm install` there — it links AGENTS.md and `docs/roles/` into the tree. Work only there.
3. Code and test as CONTRIBUTING.md requires: one test per changed behaviour, no dead code, 200
   lines per file, English everywhere, a pull request within the size of AGENTS.md rule 11 (an issue that needs more is delivered in the steps the CTO orders on it). Then review your diff twice, **with the real skills,
   invoked through the Skill tool, never imitated by hand**: first the `simplify` skill (it
   launches its own review agents, at most 4, which launch none), then the `code-review` skill
   with `--fix`, then a read against the issue's To do and Proof. Apply what they find.
4. Gates: `pnpm run check:changed`, `pnpm run test:changed`, then the group your diff touches —
   `pnpm run validate --group quick` (sources), `--group typescript` (build and products),
   `--group native` (Rust and the unit suite). Then the image proof the issue names, in a
   headless Chrome of your own on a free port, killed by its PID once done. `node scripts/check-pr-size.ts` refuses more than 600
   added lines, generated and vendored paths of `.gitattributes` excepted: above, deliver the issue in
   steps (AGENTS.md rules 5 and 11).
5. Commit in small steps: `type(scope): what changed (#<n>)`, nothing else in the message.
6. Push the branch, and open no pull request (AGENTS.md rule 11). Write its body in `.worktrees/logs/<n>-pr-body.md`, on `.github/PULL_REQUEST_TEMPLATE.md`:
   `Closes #<n>` (`Part of #<n>` for a step that is not the last), what changed,
   the image proof run, and under "Local review before push" one line
   `Simplification pass: <what it found and what you fixed>` and one line `Correctness review: <same>`, copied from
   the skills' own reports (CI refuses a body without them). The reviewer completes that section.
   Check it with `PR_DRAFT=true node scripts/check-pr-body.ts < <body file>`; the lead adds `## Lead verification` and opens the pull request.
7. Return the branch, the body file and what remains unproven. Stop there.

On a fix round, the lead resumes you with `SendMessage` carrying the reviewer's findings: fix
them on the same branch (pull the reviewer's commits first), rerun step 4, push, answer each finding in one line in the body file.
