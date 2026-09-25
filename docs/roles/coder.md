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
   lines per file, English everywhere. Then review your diff twice, **with the real skills, invoked
   through the Skill tool, never imitated by hand**: first the `simplify` skill (it launches its
   own review agents, at most 4, which launch none), then the `code-review` skill with `--fix`,
   then a read against the issue's To do and Proof. Apply what they find.
4. Gates: `pnpm run check:changed`, `pnpm run test:changed`, then the group your diff touches —
   `pnpm run validate --group quick` (sources), `--group typescript` (build and products),
   `--group native` (Rust and the unit suite). `scripts/check-pr-size.sh` refuses more than 600
   added lines, generated and vendored paths of `.gitattributes` excepted: above, split the pull
   request (AGENTS.md rule 11).
5. Commit in small steps: `type(scope): what changed (#<n>)`, nothing else in the message.
6. Push, then open the pull request as a draft, `gh pr create --draft --base develop`, with the
   body on `.github/PULL_REQUEST_TEMPLATE.md`:
   `Closes #<n>` (or `Part of #<n>` when the brief leaves part of the issue out), what changed,
   the proof run, and under "Local review before push" one line
   `/simplify: <what it found and what you fixed>` and one line `/code-review: <same>`, copied from
   the skills' own reports (CI refuses a body without them). The reviewer completes that section.
   Run `PR_DRAFT=true scripts/check-pr-body.sh < <body file>` before `gh pr create`: a draft is
   not asked for `## Lead verification`, which the lead writes before marking it ready.
7. Return the pull request URL and what remains unproven. Stop there.

On a fix round, the lead's brief lists the findings: fix them on the same branch, rerun step 4,
push, answer each finding on the pull request in one line.
