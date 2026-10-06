# Trillion3D — agent rules

[CONTRIBUTING.md](CONTRIBUTING.md) wins over this file; read only the sections your change touches.
One session carries one issue alone (CONTRIBUTING.md "Contribution workflow"); a session started
with a skill follows it. Speak to the boss in short, simple French; the repository is English.
Sub-agents run in the foreground, one task each, and launch none. Never the Fable model.

1. **No image loss**, even declared (CONTRIBUTING.md "Image and fidelity"); only fluids may lower
   their own quality to hold budget.
2. **Benches, Chrome, timings and thumbnails are the recette's alone** (`/t3d-recette`), after the
   merges; they never block one.
3. Kill only your own processes, by PID; never `pkill`, `killall` or a pattern.
4. Branch `<issue>-<name>` in `.worktrees/<branch>/`, logs in `.worktrees/logs/`; never commit on
   `develop` or `main`.
5. Issues open only through `/t3d-writer`. One issue, one pull request (`Closes #n`). A claimed
   issue (`in progress`, an assignee) is not taken until one hour passes without activity.
6. Every To-do and Proof item of the issue is delivered; none left out without the boss's yes.
7. Reuse the engine's API; a second mechanism beside it is a defect.
8. Everything is TypeScript; the witness library serves the bench only.
9. Commits: no trailer, co-author, tool name or forced identity.
10. Measurement outputs (`.mesure/out/`) are deleted once their numbers are posted.
11. Pull requests: reviewed, auto-merge on, assigned to `pasquelin`, merged within the hour (a
    release excepted), never closed unmerged.

Before you stop, clean your worktrees, branches and processes.
