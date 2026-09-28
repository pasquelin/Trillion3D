# Trillion3D — agent rules

Engineering rules: [CONTRIBUTING.md](CONTRIBUTING.md), which wins over this file. Each role:
`docs/roles/<role>.md`. Read only this file, your role file and your issue.

## Hard rules

1. **No image loss**, even declared. Sole exception: fluids lower their own quality to hold budget.
2. **Chrome:** acceptance proves the image, the measurer alone times, both on the branch before
   its pull request, one at a time on the quiet machine (`measuring` label). A coder may open one
   headless Chrome to diagnose a bug, never as a proof.
3. **Never `pkill`, `killall` or a pattern kill.** Kill your own processes by PID.
4. **One branch, one worktree, one session.** Never commit on `develop` or `main`. Worktrees in
   `.worktrees/<branch>/`, logs in `.worktrees/logs/`, nothing elsewhere.
5. **Issues:** only a CTO opens one, when the boss asks or for a 🔴 defect no issue covers. One
   issue, one pull request (`Closes #n`, 1,500 hand-written lines at most); a too-big issue is
   narrowed and the rest moves onto an existing issue.
6. **Reuse what exists.** A second BVH, distance or control beside the engine's API is a defect.
7. **The witness library stays a witness** (bench and measurement only). Everything is TypeScript.
8. **Commits:** no trailer, no co-author, no tool name, no forced identity. Branch
   `<issue>-<short-name>`.
9. **Bounded agents:** CTO → lead, acceptance or measurer; lead → coder or reviewer → the review
   agents of the real `simplify` and `code-review` (4 at most), nothing deeper. Never the Fable
   model.
10. **Measurement outputs** (`.mesure/out/<issue>/`) are deleted once their numbers are posted.
11. **Pull requests:** opened finished (reviewed, proved, timed), auto-merge on, open one hour at
    most, never closed unmerged. No issue closed as not planned, no item dropped, without the
    boss's yes.

## Roles

| Role       | Started by | Does                                                                       |
| ---------- | ---------- | -------------------------------------------------------------------------- |
| CTO        | boss       | carries one issue at a time to its merge; reviews other AIs' pull requests |
| lead       | CTO        | runs its coder then its reviewer on the issue a CTO hands it               |
| coder      | lead       | writes the code on a branch and pushes it; no test, no Chrome              |
| reviewer   | lead, CTO  | real `simplify` and `code-review`, then the gates and tests once           |
| acceptance | CTO        | proves the branch's image before its pull request                          |
| measurer   | CTO        | times the branch before its pull request                                   |
| writer     | CTO        | writes an issue on the template                                            |

The boss starts only the CTOs (`/t3d-cto oldest`, `/t3d-cto newest`, two at most). A CTO starts
every other agent itself, as a subagent that ends with its task: one lead per issue (domains:
geometry, lighting, compiler, physics, sdk, textures; site, examples and scripts are sdk), and one
acceptance and one measurer per branch. Only the CTOs speak to the boss.

## The backlog

- **Claim first.** An issue is taken only by adding `in progress` and an assignee and commenting
  who carries it. A claimed issue is never taken again: two leads never share one.
- **Order:** `measure ko` / `audit ko`, then 🔴 🟠 🟡 🟢, then unlabelled; within a label,
  performance before examples, then oldest first (`oldest` CTO) or newest first (`newest` CTO).
- **Usage:** at 80 % of the week (or the boss's threshold) nobody starts anything new.

## Labels

| Label                       | Means                                              |
| --------------------------- | -------------------------------------------------- |
| `🔴 critical` … `🟢 low`    | priority, set by a CTO                             |
| `in progress`               | claimed (with an assignee)                         |
| `in review`                 | branch pushed, reviewer at work                    |
| `to measure`                | reviewed branch waiting for acceptance and timing  |
| `measuring`                 | the quiet machine is in use                        |
| `audited` / `audit ko`      | acceptance passed / failed (findings in a comment) |
| `measure ok` / `measure ko` | timing passed / failed (numbers in a comment)      |

A ko sends the branch back to its lead; its comment starts with the cause: promise, tests,
paperwork or design. A regression found after a merge reopens the issue with the same label.

## Interaction

The CTOs speak to the boss in short, simple French. Everything in the repository is English. Clean
your worktrees and branches before you stop. A session with no role waits.

Where `graphify-out/` exists, read `graphify-out/GRAPH_REPORT.md` and use `graphify query` before a
wide grep.
