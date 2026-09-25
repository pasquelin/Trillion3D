# Role: reviewer

A subagent a lead launches with a fresh context: "follow `docs/roles/reviewer.md` for pull
request #<n>". You clean and check one pull request, then give the lead a verdict. You never
merge and never run Chrome, a browser proof or the bench.

1. `gh pr view <n>`, `gh pr diff <n>`, the linked issue. Check out the branch in a worktree of your
   own (`git worktree add .worktrees/review-<n> <branch>`), `pnpm install`, work there.
2. **Simplification pass** — invoke the real `simplify` skill through the Skill tool on your
   worktree. It launches its own review agents (at most 4, which launch none): never replace it
   with your own reading. Apply its fixes.
3. **Correctness pass** — invoke the real `code-review` skill with `--fix`. Then check the
   auditor's list yourself, because the audit re-reads every merge against it
   (`docs/roles/auditor.md` step 3):
   - every To do and Proof item of the issue is delivered, and the body says `Closes #<n>`;
   - each changed behaviour has a test that fails on `develop`, on the issue's fixture, waiting
     for events, never a fixed delay, and never comparing a result with itself;
   - labels are right, docs and translations follow, an added example has its thumbnail or
     `to measure`, and a changed format bumps its version;
   - a diff under geometry, streaming, memory, shadows or examples accounts for
     CONTRIBUTING.md §Streaming, memory and shadows;
     then this checklist,
     most severe first:
   - the issue: does the diff do what it asks, one test per changed behaviour, every number
     measured, never estimated;
   - CONTRIBUTING.md §Image and fidelity and AGENTS.md rule 1: no image loss;
   - §Quality and evidence, §Engine and package boundaries, §Native compiler: lines, duplicates,
     English, dead code, claims, format versions, self-containment;
   - AGENTS.md rules 6 and 7: reuse, the witness library kept a witness, TypeScript.
     Fix what is certain; a finding you cannot fix without changing the batch's intent goes to the
     lead.
4. Commit `refactor|fix(scope): … (#<issue>)`, then merge `origin/develop` into the branch
   (`git fetch origin`, `git merge origin/develop`), then the gates: `pnpm run check:changed`,
   `pnpm run test:changed`, the validate group the diff touches. Push once: one CI run covers the
   update and the fixes.
5. Fill "Local review before push" in the pull request body: one line `/simplify: …` and one line
   `/code-review: …` with what each skill found and fixed, copied from its report (CI refuses a
   body without them), then the auditor-list result.
6. Answer the lead with the findings in short lines and a last line: `OK` when the pull request is
   ready to merge, `KO` with what the coder must change otherwise. Remove your worktree.
