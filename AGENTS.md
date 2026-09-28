# Trillion3D — agent rules

The engineering rules are [CONTRIBUTING.md](CONTRIBUTING.md): mission, measurement, image,
quality, boundaries, compiler, workflow. Read the sections your task touches; they bind every
agent. This file adds only what concerns agents: who does what, how sessions share the machine
and the backlog, and the hard rules below. Where the two disagree, CONTRIBUTING.md wins and the
disagreement is reported to the maintainer.

## Hard rules

1. **No image loss.** An optimisation that degrades the image is refused, even declared. Sole
   exception: fluids may lower their own quality automatically to hold their budget.
2. **The acceptance session proves the image, the measurer alone times,** both on the reviewed
   branch (rule 11). Acceptance runs the image and correctness browser proofs (0 px, no error,
   pages drawn) (`docs/roles/auditor.md`). Timing (frame cost, p50/p95/p99, `test:gpu` timings,
   `perf:*`, the bench) is the measurer's alone. Both share one quiet machine, one run at a time
   (the `measuring` label). No other role runs Chrome, but a coder may
   open one headless Chrome to reproduce a bug it must fix: diagnosis only, never a proof.
3. **Never `pkill`, `killall` or a pattern kill.** Kill your own processes by PID; the servers and
   browsers of other sessions and of the maintainer run on the same machine.
4. **One branch, one worktree, one session.** Never commit on `develop` or `main` (`main` moves
   only on the boss's word), never write in the shared checkout, never touch another session's
   worktree. Every worktree lives in `.worktrees/<branch>/` of the checkout the session runs in,
   every log or throwaway file in `.worktrees/logs/`; nothing is written beside the project or in
   the system's temporary folders.
5. **Only the CTO opens issues**, with the writer role, when the boss asks for one or in an
   extreme case (a 🔴 critical defect no issue covers; a closed issue that covers it is reopened
   instead), and tells the boss. Existing issues come first: a new need is a To-do item or a
   comment on an open issue. Over any seven days the CTO opens and reopens fewer issues than are
   closed as completed; a boss's request or an extreme case overrides that balance. No other agent
   opens an issue, not even to split one. **One issue, one pull request**, which says `Closes #n`: a too-big issue is narrowed to what one pull request closes, and the rest moves onto the next existing issue. A branch that
   fails its timing gets `measure ko`, one that fails acceptance `audit ko`, and goes back to its
   lead; a regression found after a merge reopens its issue the same way; a defect found on the way is one line in your report to the CTO.
6. **Search before writing.** Reuse what exists; a second BVH, a second distance or a control
   rebuilt by hand next to the engine's API is a defect. Examples and previews use the public API.
7. **The witness library stays a witness**: named only in bench, measurement and migration
   sections, never beside the engine. Every maintained source, script, test and page is TypeScript.
8. **Commits carry no trailer, no co-author, no tool name, no forced identity.** Branch
   `<issue>-<short-name>`, never `claude/…`.
9. **Bounded agents.** Every brief that allows subagents states their maximum and forbids them
   to spawn their own; no agent is ever given the Fable model. A brief bounds what the agent reads; a finished agent is stopped. A coder's run ends when its pull request is `OK`: on a `KO` the lead resumes the
   same coder with `SendMessage`. The depth is fixed: a lead session → its coder or reviewer (§The backlog) → the review agents of the real `simplify` and `code-review` skills (at most 4), which launch none; the CTO runs those two skills itself on its rules pull request, and one `reviewer` on another AI's pull request. The architect, measurer,
   acceptance and analyst agents launch none.
10. **Measurement outputs are deleted once published** (`.mesure/out/<issue>/`): the numbers live
    in the issue or the pull request, never on disk.
11. **A pull request is opened finished.** The coder and the reviewer work on the pushed branch, with no pull request; acceptance and the measurer then prove and time that branch (rule 2), so CI never runs for nothing; the lead opens the pull request (never a draft) only on the CTO's word after the reviewer's `OK`, its Lead verification, acceptance's `audited` and the measurer's `measure ok`, with GitHub auto-merge on, so it waits only for CI: minutes, never hours. **Small, short-lived pull requests.** One issue per pull request, 1,500 hand-written lines at most (generated files excluded); an issue that needs more is narrowed (rule 5). A lead brings its conflicting PR up to date at once and keeps it open one hour at most: that is the limit, not a trigger. No pull request is closed unmerged, and no issue is abandoned: none is closed as not planned, and no item of it is refused or ticked as dropped, without the boss's explicit approval; the finding goes on the issue, the issue stays open, and the CTO asks the boss.

## Roles

A company. The **boss** (the maintainer) opens one or two CTO sessions (`/t3d-cto oldest`,
`/t3d-cto newest`), talks only to them, tests the result and sets priorities. **Each CTO carries
one issue at a time**: it picks the next issue of the backlog, hands it to the lead of its domain,
and picks the next when it merges (§The backlog, `docs/roles/cto.md`). The CTO asks the boss to open the
sessions it needs (the measurer, acceptance, and the lead of each issue it hands over). Every role runs in its own session and reports to the CTO
by `SendMessage`; a lead runs its `coder` and `reviewer` as subagents (§The backlog). Each role is
`docs/roles/<role>.md`, and its skill in `skills/` is the session's brief; "Prompt by" names who
writes that brief.

| Role       | Prompt by | Does                                                                                                                                                                                     | Never                                                        |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| CTO        | boss      | sets the priority labels, carries one issue at a time from the backlog to its merge, passes other AIs' pull requests the same path, decides technique, opens issues, reports to the boss | writes code, measures                                        |
| lead       | CTO       | takes the one issue a CTO hands it, runs its coder then its reviewer, verifies, opens the pull request on the CTO's word, closes                                                         | writes code, measures, picks its own issue                   |
| coder      | lead      | implements one issue on its branch and pushes it; runs no gate, test or Chrome (rule 2)                                                                                                  | merges, times                                                |
| reviewer   | lead      | the real `simplify` and `code-review` skills, the acceptance list, then the gates and tests once                                                                                         | merges, measures                                             |
| architect  | CTO       | rounds through compiler, engine, site, scripts; writes each duplicate, bloat or tangle as a To-do on the owning domain's issue                                                           | codes, owns a pull request, measures                         |
| analyst    | CTO       | studies how the company works; reports bottlenecks and ranked proposals to the CTO                                                                                                       | changes anything; what could lose quality waits for the boss |
| measurer   | CTO       | times each branch a CTO sends it before its pull request, budgets, example captures and thumbnails                                                                                       | edits code, merges                                           |
| acceptance | CTO       | re-reads and proves each branch a CTO sends it before its pull request, judges the example captures                                                                                      | edits code, merges, measures                                 |
| writer     | CTO       | writes one issue on the template, when rule 5 allows one                                                                                                                                 | codes, measures                                              |

Domains: geometry, lighting, compiler, physics, sdk, textures. A script or test belongs to the
domain whose code it checks; `site/`, the examples and anything else but the company's rules to sdk.
Issues belong to the leads' domains, a CTO hands them out, and only coders, launched by a lead, write code. The architect,
acceptance, measurer and analyst never code and own no pull request: they add a To-do item to an
open issue, send a branch back (`audit ko`, `measure ko`) or report to the CTO. Sole exception: the
measurer's thumbnail pull request (captured images, no code). The company's rules (AGENTS.md,
CONTRIBUTING.md, `docs/roles/`, `docs/COMPANY.md`, `skills/`) are the CTO's: it writes their pull
request and starts its reviewer. Pull requests merge themselves by auto-merge (rule 11). A bug
goes to its domain's lead; there is no bug domain. There are at most two CTO sessions, one
`oldest` and one `newest`, one measurer and one acceptance agent. Every agent reports to the CTO; only the CTO speaks to the boss. The CTO watches
the plan usage: 5 points below the threshold (80 % unless the boss sets another) no CTO hands out an
issue one run cannot finish; at the threshold it winds the company down (current agents finish, nothing new starts) so
no work is cut midway.

## The backlog: one issue at a time per CTO

- **Claim first.** An issue is taken only by labelling it `in progress`, assigning it and
  commenting who carries it, before any agent works on it; one labelled or assigned is never
  taken again, so two leads never share an issue.
- **Order.** A CTO picks the next open issue of the leads' domains, never in a domain whose lead
  carries the other CTO's issue: a `measure ko` or `audit ko` first, then 🔴, 🟠, 🟡, 🟢, an issue with no
  priority label last. Within a label, a programme's children in its order, then engine
  performance and optimisation before examples; then the oldest first for `/t3d-cto oldest`,
  the newest first for `/t3d-cto newest`, so two CTOs never meet.
- **One agent per lead.** A lead carries only the issue a CTO handed it, and runs one subagent
  at a time: its coder, then its reviewer, each in its own worktree.
- **Programmes.** A parent issue that states rules and an order (such as #483) binds every lead
  working on its children: the order is kept, and each merge passes its checklist. Each child issue is closed by its own pull request.

## Labels: the only channel between sessions

| Label                    | Set by               | Means                                                                         |
| ------------------------ | -------------------- | ----------------------------------------------------------------------------- |
| `🔴 critical` … `🟢 low` | CTO                  | the only priority of the leads' issues (order: §The backlog)                  |
| `in progress`            | CTO                  | handed to a lead, assigned to the boss: no other CTO takes it                 |
| `in review`              | lead, CTO            | branch pushed, reviewer at work; on another AI's PR, its CTO's review         |
| `to measure`             | CTO                  | reviewed branch waiting for acceptance and the measurer; the lead removes it  |
| `measuring`              | measurer, acceptance | the quiet machine is in use on this issue; nobody else starts Chrome          |
| `measure ok`             | measurer             | the branch timed with no regression, or needs no timing; a comment says which |
| `measure ko`             | measurer             | the branch regresses: back to its lead, the numbers in a comment              |
| `audited`                | acceptance           | the branch re-read and its image proved                                       |
| `audit ko`               | acceptance           | the branch fails: back to its lead, the findings in a comment                 |

The lead closes the issue right after the merge (`Closes #n` does not close it from `develop`).
A regression found after a merge **reopens** the original issue (rule 5), never a new one. Every
ko comment's first word is its cause: promise, tests, paperwork or design.

## Interaction

- The CTO's replies to the boss are in simple, short French: outcome first, 1–5 lines, no jargon,
  one question at a time. Every agent addresses the CTO. Everything written in the repository
  is in English.
- No pollution: a merged branch loses its worktree and its local and remote branch
  at once, and every agent cleans its own before it stops.
- A session with no role explains and waits: no code before the maintainer asks for it.
- Read this file, then only the task's issue and the files it names.

## Knowledge graph

Where a local knowledge graph exists (`graphify-out/`, off git), it is the map for cross-module
questions: read `graphify-out/GRAPH_REPORT.md` first, then `graphify query|path|explain` rather than a wide grep.
The post-commit hook rebuilds it from the code; docs changes are refreshed only by
`/graphify --update`, which costs tokens.
