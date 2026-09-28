# Trillion3D — agent rules

Engineering rules: [CONTRIBUTING.md](CONTRIBUTING.md), which wins over this file; read only the
sections your change touches. Your role is the skill or agent file you were started with.

## Who starts whom

```
boss ─> CTO = one dev team (/t3d-cto, as many teams as the boss opens)
         └─> lead (agent) ─┬─> coder (agent)
                           └─> reviewer (agent) ─> review agents of simplify and code-review
boss ─> recette (/loop 2h /t3d-recette, its own session): image proof of develop
boss ─> measure (/loop 2h /t3d-measure, its own session): timing of develop
```

Teams, each its own session, meet only on GitHub: any number of **dev** teams (a CTO and its leads),
one **recette** and one **measure**. Any assistant may run a dev team (Claude, ChatGPT, …): it
claims the next free issue, codes it on a branch, reviews it and opens the pull request. With
subagents it delegates as above; without, it does the lead, coder and reviewer steps itself, in that
order.

Only a CTO launches in the background; every other agent launches its children in the foreground and
waits for them. Nothing goes deeper. Never the Fable model. Only the CTOs, recette and measure speak
to the boss, in short, simple French; everything in the repository is English.

## Hard rules

1. **No image loss**, even declared. Sole exception: fluids lower their own quality to hold budget.
2. **Chrome** proofs are the recette session's, timings the measure session's, by batch on `develop`
   after the merges; they never block a merge. A coder may open one headless Chrome to diagnose a
   bug, never as a proof.
3. **Never `pkill`, `killall` or a pattern kill.** Kill your own processes by PID.
4. **One branch, one worktree.** Never commit on `develop` or `main`. Worktrees in
   `.worktrees/<branch>/`, logs in `.worktrees/logs/`, nothing elsewhere; run git with
   `git -C <worktree>`.
5. **Issues:** only a CTO, recette or measure opens one (on `.github/ISSUE_TEMPLATE/task.md`,
   `/t3d-writer` does it), when the boss asks or for a
   defect no issue covers. One issue, one pull request (`Closes #n`, 1,500 hand-written lines at
   most). A claimed issue (`in progress`, an assignee) is never taken by another team, until a CTO
   frees it as abandoned (one hour without a commit, comment or pull request).
6. **The whole issue, always.** Every To-do and Proof item is delivered in its pull request; none
   is left for later, moved to another issue or marked done in part without the boss's yes. One
   item missing is a `KO`. Sole exception: at claim time, before any code, a CTO narrows an issue
   too big for one pull request and moves the rest onto an existing issue.
7. **Reuse what exists.** A second BVH, distance or control beside the engine's API is a defect.
8. **The witness library stays a witness** (bench and measurement only). Everything is TypeScript.
9. **Commits:** no trailer, no co-author, no tool name, no forced identity. Branch
   `<issue>-<short-name>`.
10. **Measurement outputs** (`.mesure/out/<issue>/`) are deleted once their numbers are posted.
11. **Pull requests:** opened reviewed, auto-merge on, assigned to `pasquelin`, open one hour at
    most (a release pull request excepted), never closed unmerged. No issue closed as not planned without the boss's yes.

Clean your worktrees and branches before you stop. A session with no role waits. Where
`graphify-out/` exists, use `graphify query` before a wide grep.
