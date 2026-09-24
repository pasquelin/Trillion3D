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
5. **Never open an issue** unless the maintainer asks. A defect found on the way is one line in
   your report. Sole exceptions: the measurer opens one per regression, and a lead splits an
   issue too large for one pull request; both write it as the writer. The auditor never opens
   one: a finding reopens the audited issue.
6. **Search before writing.** Reuse what exists; a second BVH, a second distance or a control
   rebuilt by hand next to the engine's API is a defect. Examples and previews use the public API.
7. **The witness library stays a witness**: named only in bench, measurement and migration
   sections, never beside the engine. Every maintained source, script, test and page is TypeScript.
8. **Commits carry no trailer, no co-author, no tool name, no forced identity.** Branch
   `<issue>-<short-name>`, never `claude/…`.
9. **Bounded agents.** Every brief that allows subagents states their maximum and forbids them
   to spawn their own. A brief bounds what the agent reads; a finished agent is stopped.
10. **Measurement outputs are deleted once published** (`.mesure/out/<issue>/`): the numbers live
    in the issue or the pull request, never on disk.

## Roles

Three kinds of session, started by the maintainer — lead, measurer, auditor — two roles a lead
launches as subagents — coder, reviewer — and the writer, which anyone uses to write an issue.
Each role is `docs/roles/<role>.md`.

| Role     | Started by | Does                                                              | Never                        |
| -------- | ---------- | ----------------------------------------------------------------- | ---------------------------- |
| lead     | maintainer | owns one domain, delegates, merges, labels                        | writes code, measures        |
| coder    | lead       | implements one issue, opens the pull request                      | merges, measures             |
| reviewer | lead       | simplification then correctness pass on one pull request, verdict | merges, measures             |
| measurer | maintainer | the one queue of browser proofs and benchmarks, on merged batches | edits code, merges           |
| auditor  | maintainer | re-reads every merge on `develop` against CONTRIBUTING.md         | edits code, merges, measures |
| writer   | anyone     | writes one issue on the template, from its patterns               | codes, measures              |

Several leads may run at once, one domain each (a label or an issue list given at launch). There
is one measurer and one auditor.

## Labels: the only channel between sessions

| Label         | Set by   | Means                                                      |
| ------------- | -------- | ---------------------------------------------------------- |
| `in progress` | lead     | taken: no other lead touches it                            |
| `in review`   | lead     | pull request open, reviewer at work                        |
| `to measure`  | lead     | closed engine issue waiting in the measurer's queue        |
| `measuring`   | measurer | being measured now                                         |
| `measure ok`  | measurer | measured, no regression; numbers in a comment              |
| `measure ko`  | measurer | on a new issue: the regression, linked to the measured one |
| `audited`     | auditor  | on the pull request: the merge was re-read                 |
| `audit ko`    | auditor  | on the audited issue, reopened: the findings in a comment  |

Measuring and auditing never block a pull request: the issue closes at merge, the measurer and the
auditor only comment on it. A regression becomes a new issue carrying the original's domain
label; an audit finding reopens the original. A lead always takes the `measure ko` and
`audit ko` issues of its domain before a new one.

## Interaction

- Replies to the maintainer are in simple, short French: outcome first, 1–5 lines, no jargon, one
  question at a time. Everything written in the repository is in English.
- A session with no role explains and waits: no code before the maintainer asks for it.
- Read this file, then only the task's issue and the files it names.

## Knowledge graph

Where a local knowledge graph exists (`graphify-out/`, off git), it is the map for cross-module
questions: read `graphify-out/GRAPH_REPORT.md` first, then `graphify query|path|explain` rather than a wide grep.
The post-commit hook rebuilds it from the code; docs changes are refreshed only by
`/graphify --update`, which costs tokens.
