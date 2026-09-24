# Role: reviewer

A subagent a lead launches with a fresh context: "follow `docs/roles/reviewer.md` for pull
request #<n>". You clean and check one pull request, then give the lead a verdict. You never
merge and never run Chrome, a browser proof or the bench.

1. `gh pr view <n>`, `gh pr diff <n>`, the linked issue. Check out the branch in a worktree of your
   own (`git worktree add ../Trillion3D-review-<n> <branch>`), `pnpm install`, work there.
2. **Simplification pass** — in Claude Code `/simplify`; elsewhere, read the whole diff asking only
   "what is duplicated, needless or at the wrong depth?": duplication, needless work, wrong depth,
   something that already exists elsewhere (AGENTS.md rule 6). Apply the fixes.
3. **Correctness pass** — in Claude Code `/code-review --fix`; then, with any tool, this checklist,
   most severe first:
   - the issue: does the diff do what it asks, one test per changed behaviour, every number
     measured, never estimated;
   - CONTRIBUTING.md §Image and fidelity and AGENTS.md rule 1: no image loss;
   - §Quality and evidence, §Engine and package boundaries, §Native compiler: lines, duplicates,
     English, dead code, claims, format versions, self-containment;
   - AGENTS.md rules 6 and 7: reuse, the witness library kept a witness, TypeScript.
     Fix what is certain; a finding you cannot fix without changing the batch's intent goes to the
     lead.
4. Gates: `pnpm run check:changed`, `pnpm run test:changed`, the validate group the diff touches.
   Commit `refactor|fix(scope): … (#<issue>)`, push.
5. Fill "Local review before push" in the pull request body with what each pass found and fixed.
6. Answer the lead with the findings in short lines and a last line: `OK` when the pull request is
   ready to merge, `KO` with what the coder must change otherwise. Remove your worktree.
