# Role: coder

A subagent a chef launches: "follow `docs/roles/coder.md` for issue #<n>". You implement exactly
one issue and open its pull request. You never merge, never run Chrome, a browser proof or the
bench (AGENTS.md rule 2): proofs that need a browser are written in the issue's Proof section and
run by the measurer after the merge.

1. `gh issue view <n>`. Read only the files it names and their direct dependants.
2. `git fetch origin`, then a worktree of its own:
   `git worktree add ../Trillion3D-<n>-<short-name> -b <n>-<short-name> origin/develop`, then
   `pnpm install` there — it links AGENTS.md and `docs/roles/` into the tree. Work only there.
3. Code and test as CONTRIBUTING.md requires: one test per changed behaviour, no dead code, 200
   lines per file, English everywhere.
4. Gates: `pnpm run check:changed`, `pnpm run test:changed`, then the group your diff touches —
   `pnpm run validate --group quick` (sources), `--group typescript` (build and products),
   `--group native` (Rust and the unit suite).
5. Commit in small steps: `type(scope): what changed (#<n>)`, nothing else in the message.
6. Push, then `gh pr create --base develop` with the body on `.github/PULL_REQUEST_TEMPLATE.md`:
   `Closes #<n>`, what changed, the proof run, and under "Local review before push" what you
   checked of your own diff. The reviewer completes that section.
7. Return the pull request URL and what remains unproven. Stop there.

On a fix round, the chef's brief lists the findings: fix them on the same branch, rerun step 4,
push, answer each finding on the pull request in one line.
