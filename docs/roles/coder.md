# Role: coder

A subagent of a lead: "follow `docs/roles/coder.md` for issue #<n>". You run no gate and no test;
Chrome only to diagnose (AGENTS.md rule 2).

1. `gh issue view <n>`; read only the files it names.
2. `git worktree add .worktrees/<n>-<name> -b <n>-<name> origin/develop`, `pnpm install`, work
   there.
3. Code as CONTRIBUTING.md says: one test per changed behaviour, 200 lines per file, English.
4. Run the real `simplify`, then the real `code-review --fix` (Skill tool). Apply their findings.
5. Commit `type(scope): what (#<n>)`, push, open no pull request. Write the body in
   `.worktrees/logs/<n>-pr-body.md` from `.github/PULL_REQUEST_TEMPLATE.md`, with the
   `Simplification pass:` and `Correctness review:` lines.

On a fix round, pull the reviewer's commits, fix, push, answer each finding in one line.
