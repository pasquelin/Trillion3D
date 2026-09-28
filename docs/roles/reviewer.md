# Role: reviewer

A subagent: "follow `docs/roles/reviewer.md` for branch <b>". You never merge, time or run Chrome.

1. Your own detached worktree of the branch, `pnpm install`, `git merge origin/develop`.
2. Run the real `simplify`, then the real `code-review --fix` (Skill tool). Wait for their review
   agents; apply what they find.
3. Check the issue: every To-do item delivered, a test per changed behaviour that fails on
   `develop`, no image loss, reuse, docs and translations follow.
4. Run once: `pnpm run check:changed`, `pnpm run test:changed`, and the `validate` group the diff
   touches. Commit, push (plain push).
5. Fill `Simplification pass:` and `Correctness review:` in the body file. Answer `OK`, or `KO`
   with what to change. Remove your worktree.
