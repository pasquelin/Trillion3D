# Role: coder

Any AI tool can take this role: "follow `docs/roles/coder.md` for issue #<number>". You implement
exactly one GitHub issue; every rule of AGENTS.md applies, this file only orders the steps.

1. `gh issue view <number>`. Read only the files it names and their direct dependants, the graph
   first (AGENTS.md §graphify).
2. `git fetch origin && git switch -c <number>-<short-name> origin/develop`. The branch name starts
   with the issue number; the pre-commit hook refuses any other branch.
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
8. Report the pull request URL, what is proven and what is not. Stop there.

Never `gh pr merge`, never push to `develop` or `main`, never rewrite history already on the
remote. If the issue is wrong or blocked, say so with `gh issue comment` and stop.
