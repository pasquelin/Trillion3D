# Role: coder

Any AI tool can take this role: "follow `docs/roles/coder.md` for issue #<number>". You implement
exactly one GitHub issue; every rule of AGENTS.md applies, this file only orders the steps.

1. `gh issue view <number>`. Read only the files it names and their direct dependants, the graph
   first (AGENTS.md §graphify).
2. `git fetch origin`, then cut the branch in a worktree of its own — the shared checkout may hold
   another agent's batch, and two agents in one tree overwrite each other:
   `git worktree add ../webGeometry-<number>-<short-name> -b <number>-<short-name> origin/develop`,
   then `pnpm install` in it and work there. The branch name starts with the issue number; the
   pre-commit hook refuses any other branch. A sibling tree has no `.mesure/assets/` of its own
   (off git): a batch that measures points `WG_ASSETS` at the shared one. The tree outlives your
   report, since merging is the maintainer's; it is removed with `git worktree remove` and
   `git branch -d` once the branch is merged, by whoever comes to it first.
3. Code and test as AGENTS.md §Quality and evidence and §Engine and package boundaries require.
4. `pnpm run check:changed`, then `pnpm run test:changed`, then `pnpm run validate`.
5. Commit in small steps, message `type(scope): what changed (#<number>)`, no trailer, no
   co-author line, no AI tool name.
6. Review your own diff before it leaves the machine, in this order (AGENTS.md §Workflow):
   - simplification pass — in Claude Code `/simplify`; elsewhere, read the whole diff asking only
     "what is duplicated, needless or at the wrong depth?" and apply the fixes;
   - correctness pass — in Claude Code `/code-review --fix`; elsewhere, apply the checklist of
     `docs/roles/reviewer.md` step 2 to the local diff and fix every finding.
     Rerun step 4, commit, and only then push.
7. `gh pr create --base develop`, body on `.github/PULL_REQUEST_TEMPLATE.md`: `Closes #<number>`,
   what changed, the proof, and "Local review before push" — what each pass found and fixed. The
   CI refuses a pull request whose section is empty.
8. Hand the pull request to the reviewer role as a **separate agent with a fresh context** — in
   Claude Code the `reviewer` subagent, elsewhere a second agent told to follow
   `docs/roles/reviewer.md` for that pull request — and loop with it until it answers `READY`:
   - fix every finding, rerun step 4, push, answer each comment on the pull request with what
     was changed;
   - send the same reviewer agent (its context kept) the list of fixes and ask for a re-check;
   - stop after three rounds if it still answers `NOT READY`, and report what is left.
     Never argue a finding away: a finding you disagree with is answered on the pull request, with
     the reason, and left to the maintainer.
9. Report the pull request URL, the reviewer's verdict and rounds, and what remains unproven.
   Stop there: merging is the maintainer's.

Never `gh pr merge`, never push to `develop` or `main`, never rewrite history already on the
remote. If the issue is wrong or blocked, say so with `gh issue comment` and stop.
