# Trillion3D — agent rules

The engineering rules are [CONTRIBUTING.md](CONTRIBUTING.md): mission, measurement, image,
quality, boundaries, compiler, workflow. Read the sections your task touches; they bind every
agent. This file adds only what concerns agents: who does what, how sessions share the machine
and the backlog, and the hard rules below. Where the two disagree, CONTRIBUTING.md wins and the
disagreement is reported to the maintainer.

## Hard rules

1. **No image loss.** An optimisation that degrades the image is refused, even declared. Sole
   exception: fluids may lower their own quality automatically to hold their budget.
2. **Only the measurer runs Chrome, a browser proof, `test:gpu`, `perf:*` or the bench.** Every
   other role runs the fast gates only. One Chrome on the machine at a time.
3. **Never `pkill`, `killall` or a pattern kill.** Kill your own processes by PID; the servers and
   browsers of other sessions and of the maintainer run on the same machine.
4. **One branch, one worktree, one session.** Never commit on `develop` or `main`, never write in
   the shared checkout, never touch another session's worktree. Every worktree lives in
   `.worktrees/<branch>/` inside the project, every log or throwaway file in `.worktrees/logs/`;
   nothing is written beside the project or in the system's temporary folders.
5. **Only the CTO opens issues**, from the boss's words, with the writer role. No
   other session opens one, not even to split an issue. What a pull request does not deliver
   stays in its own issue: the PR says `Part of #n`, the rest is a comment on #n, the issue stays
   open. A regression reopens the measured issue with `measure ko`; a finding reopens the audited
   issue with `audit ko`. A defect found on the way is one line in your report to the maintainer.
6. **Search before writing.** Reuse what exists; a second BVH, a second distance or a control
   rebuilt by hand next to the engine's API is a defect. Examples and previews use the public API.
7. **The witness library stays a witness**: named only in bench, measurement and migration
   sections, never beside the engine. Every maintained source, script, test and page is TypeScript.
8. **Commits carry no trailer, no co-author, no tool name, no forced identity.** Branch
   `<issue>-<short-name>`, never `claude/…`.
9. **Bounded agents.** Every brief that allows subagents states their maximum and forbids them
   to spawn their own. A brief bounds what the agent reads; a finished agent is stopped. The
   depth is fixed: the CTO → a lead or the architect → one coder or reviewer → the review agents
   of the real `simplify` and `code-review` skills (at most 4), which launch none. The measurer,
   acceptance, analyst and writer agents launch none.
10. **Measurement outputs are deleted once published** (`.mesure/out/<issue>/`): the numbers live
    in the issue or the pull request, never on disk.

## Roles

A company. The **boss** (the maintainer) opens **one session**, the CTO's (`/t3d-cto`), talks
only to it, tests the result and sets priorities. Every other role is a **background agent** the
CTO starts with the Agent tool and supervises; the boss never opens another session. Each role is
`docs/roles/<role>.md`, and its skill in `skills/` is the agent's brief.

| Role       | Started by | Does                                                                                                                                      | Never                                                         |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| CTO        | boss       | turns priorities into the pinned Priorities issue, starts and supervises the agents, decides technique, opens issues, reports to the boss | writes code, measures                                         |
| lead       | CTO        | owns one domain, runs its coder and reviewer, verifies, merges, closes                                                                    | writes code, measures                                         |
| coder      | lead       | implements one issue, opens the pull request                                                                                              | merges, measures                                              |
| reviewer   | lead       | the real `simplify` and `code-review` skills, then the acceptance list                                                                    | merges, measures                                              |
| architect  | CTO        | the `architecture` domain: finds duplicates, bloat and tangles through the graph, proposes, delivers behaviour-preserving refactors       | changes behaviour, measures                                   |
| analyst    | CTO        | studies how the company works; reports bottlenecks and ranked proposals to the CTO                                                        | changes anything; nothing applies without the boss's approval |
| measurer   | CTO        | budgets, browser proofs, example captures and thumbnails, after merge                                                                     | edits code, merges                                            |
| acceptance | CTO        | re-reads every merge and judges the example captures; a safety net                                                                        | edits code, merges, measures                                  |
| writer     | CTO        | writes one issue on the template, from the boss's words                                                                                   | codes, measures                                               |

Domains: geometry, lighting, compiler, physics, sdk, and architecture (the architect's). A bug goes to its domain's lead; there is no
bug domain. There is one CTO session, one measurer and one acceptance agent. Every agent reports
to the CTO; only the CTO speaks to the boss. The CTO watches the plan usage: at 80 % (or the
threshold the boss sets) it winds the company down (current agents finish, nothing new starts) so
no work is cut midway.

## Leads: limits that hold at every moment

- **Never idle.** A lead with work in its domain (an open issue, a pull request to unblock) is
  always working on it; `measure ko` and `audit ko` first, then 🔴 critical, then the oldest.
- **One agent at a time.** A lead runs one coder or one reviewer subagent at a time, never two.
- **At most 3 pull requests waiting per lead.** At 3, the lead starts no coder: it unblocks its own
  pull requests (red CI, conflict with `develop`, unanswered review) and resumes only once it is
  back at 2.
- **Programmes.** A parent issue that states rules and an order (such as #483) binds every lead
  working on its children: the order is kept, and each merge passes its checklist.

## Labels: the only channel between sessions

| Label         | Set by   | Means                                                     |
| ------------- | -------- | --------------------------------------------------------- |
| `in progress` | lead     | taken: no other lead touches it                           |
| `in review`   | lead     | pull request open, reviewer at work                       |
| `to measure`  | lead     | closed engine issue waiting in the measurer's queue       |
| `measuring`   | measurer | being measured now                                        |
| `measure ok`  | measurer | measured, no regression; numbers in a comment             |
| `measure ko`  | measurer | on the measured issue, reopened: the regression's numbers |
| `audited`     | auditor  | on the pull request: the merge was re-read                |
| `audit ko`    | auditor  | on the audited issue, reopened: the findings in a comment |

Measuring and auditing never block a pull request: the issue closes at merge, the measurer and the
auditor only comment on it. A regression or an audit finding **reopens** the original issue with
`measure ko` or `audit ko`; neither opens a new one. A lead always takes the `measure ko` and
`audit ko` issues of its domain before a new one.

## Interaction

- The CTO's replies to the boss are in simple, short French: outcome first, 1–5 lines, no jargon,
  one question at a time. Other sessions address the CTO. Everything written in the repository
  is in English.
- No pollution: a merged or abandoned branch loses its worktree and its local and remote branch
  at once, and every session cleans its own before it stops.
- A session with no role explains and waits: no code before the maintainer asks for it.
- Read this file, then only the task's issue and the files it names.

## Knowledge graph

Where a local knowledge graph exists (`graphify-out/`, off git), it is the map for cross-module
questions: read `graphify-out/GRAPH_REPORT.md` first, then `graphify query|path|explain` rather than a wide grep.
The post-commit hook rebuilds it from the code; docs changes are refreshed only by
`/graphify --update`, which costs tokens.
