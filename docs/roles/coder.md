# Role: coder

A subagent a lead launches: "follow `docs/roles/coder.md` for issue #<n>". You implement exactly
one issue and push its branch. You never merge, and you run no gate, no test, no bench and no
Chrome: the reviewer runs the gates and tests, acceptance the image proof. Sole exception: the
diagnosis Chrome of AGENTS.md rule 2, killed by its PID.

1. `gh issue view <n>`. Read only the files it names and their direct dependants.
2. `git fetch origin`, then a worktree of its own:
   `git worktree add .worktrees/<n>-<short-name> -b <n>-<short-name> origin/develop`, then
   `pnpm install` there — it links AGENTS.md and `docs/roles/` into the tree. Work only there.
3. Code and test as CONTRIBUTING.md requires: one test per changed behaviour, no dead code, 200
   lines per file, English everywhere, a pull request within the size of AGENTS.md rule 11 (CI refuses more than 1,500 added lines; an
   issue that needs more goes back to the lead to be narrowed, AGENTS.md rule 5). Then review your diff twice, **with the real skills,
   invoked through the Skill tool, never imitated by hand**: first the `simplify` skill (it
   launches its own review agents, at most 4, which launch none), then the `code-review` skill
   with `--fix`, without running tests, then a read against the issue's To do and Proof. Apply
   what they find.
4. Commit small: `type(scope): what changed (#<n>)`, nothing else in the message.
5. Push the branch, and open no pull request (AGENTS.md rule 11). Write its body in `.worktrees/logs/<n>-pr-body.md`, on `.github/PULL_REQUEST_TEMPLATE.md`:
   `Closes #<n>`, what changed, and under "Local review before push" one line
   `Simplification pass: <what it found and what you fixed>` and one line `Correctness review: <same>`, copied from
   the skills' own reports (CI refuses a body without them). The reviewer completes that section.
   The lead adds `## Lead verification` and opens the pull request.
6. Return the branch, the body file and what remains unproven. Stop there.

On a fix round, the lead resumes you with `SendMessage` carrying the reviewer's findings: fix
them on the same branch (pull the reviewer's commits first), push, answer each finding in one line in the body file.
