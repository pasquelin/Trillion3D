# Role: coder

A subagent a lead launches: "follow `docs/roles/coder.md` for issue #<n>". You implement exactly
one issue and open its pull request. You never merge, never run Chrome, a browser proof or the
bench (AGENTS.md rule 2): proofs that need a browser are written in the issue's Proof section and
run by the measurer after the merge.

1. `gh issue view <n>`. Read only the files it names and their direct dependants.
2. `git fetch origin`, then a worktree of its own:
   `git worktree add .worktrees/<n>-<short-name> -b <n>-<short-name> origin/develop`, then
   `pnpm install` there — it links AGENTS.md and `docs/roles/` into the tree. Work only there.
3. Code and test as CONTRIBUTING.md requires: one test per changed behaviour, no dead code, 200
   lines per file, English everywhere, a pull request within the size of AGENTS.md rule 11 (an issue that needs more goes back to the lead, who asks the CTO to split it). Then review your diff twice, **with the real skills,
   invoked through the Skill tool, never imitated by hand**: first the `simplify` skill (it
   launches its own review agents, at most 4, which launch none), then the `code-review` skill
   with `--fix`, then a read against the issue's To do and Proof. Apply what they find.
4. Gates: `pnpm run check:changed`, `pnpm run test:changed`, then the group your diff touches —
   `pnpm run validate --group quick` (sources), `--group typescript` (build and products),
   `--group native` (Rust and the unit suite). `scripts/check-pr-size.sh` refuses more than 600
   added lines, generated and vendored paths of `.gitattributes` excepted: above, split the pull
   request (AGENTS.md rule 11).
5. Commit in small steps: `type(scope): what changed (#<n>)`, nothing else in the message.
6. Push the branch, and open no pull request (AGENTS.md rule 11). Write its body in `.worktrees/logs/<n>-pr-body.md`, on `.github/PULL_REQUEST_TEMPLATE.md`:
   `Closes #<n>`, what changed,
   the proof run, and under "Local review before push" one line
   `/simplify: <what it found and what you fixed>` and one line `/code-review: <same>`, copied from
   the skills' own reports (CI refuses a body without them). The reviewer completes that section.
   Check it with `PR_DRAFT=true scripts/check-pr-body.sh < <body file>`; the lead adds `## Lead verification` and opens the pull request.
7. Return the branch, the body file and what remains unproven. Stop there.

On a fix round, the lead resumes you with `SendMessage` carrying the reviewer's findings: fix
them on the same branch (pull the reviewer's commits first), rerun step 4, push, answer each finding in one line in the body file.
