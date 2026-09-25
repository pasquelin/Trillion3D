# How Trillion3D is built: the company

Trillion3D is developed by a small "company" of AI agents run by one person, the **boss** (the
maintainer). This page explains who does what and how to run it. The rules themselves live in
[AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md); each role is written in
[docs/roles/](roles/). A contributor who does not use an AI assistant can ignore this page: the
contribution workflow never requires it.

## The idea in one paragraph

The boss sets priorities and tests the result. The boss opens the **CTO** session; it gives him ten launch commands, and he opens one session per command: a **lead** per domain, the architect, the analyst, measurement and acceptance. The CTO keeps the company honest and merges. Leads run a **coder** and a
**reviewer** for one issue at a time, verify the result themselves, name it ready for the CTO to
merge, and close the issue. After every
merge, **measurement** checks performance and captures the live example, and **acceptance**
re-reads the change as a safety net. An **architect** keeps the code small and logical; an
**analyst** studies how the company works and proposes improvements; the CTO applies those that
lose no quality, the boss decides the others. GitHub is the single source of truth: issues, labels
and pull requests.

## The roles

| Role                 | Skill                  | Started by | Does                                                                                                                                                                                                     | Never                     |
| -------------------- | ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Boss                 | —                      | —          | sets priorities, tests the result, approves process changes that could lose quality                                                                                                                      | —                         |
| CTO                  | `/t3d-cto`             | boss       | sets the issues' priority labels, gives the boss the ten launch commands, supervises, decides technique, opens issues, reports in five lines, winds down at 80 % of plan usage (or the boss's threshold) | writes code, measures     |
| Lead                 | `/t3d-lead <domain>`   | boss       | owns a domain (geometry, lighting, compiler, physics, sdk, textures); runs its coder and reviewer; writes the **Lead verification** before merging; closes the issue                                     | writes code, opens issues |
| Coder                | agent `coder`          | lead       | implements one issue, runs the real `simplify` and `code-review` skills, opens the PR                                                                                                                    | merges, measures          |
| Reviewer             | agent `reviewer`       | lead       | the real `simplify` and `code-review` skills, then the acceptance list; answers OK or KO                                                                                                                 | merges, measures          |
| Measurement          | `/loop /t3d-measure`   | boss       | the only one running Chrome and the bench: budgets, proofs, example captures and thumbnails                                                                                                              | edits code, merges        |
| Acceptance (recette) | `/loop /t3d-recette`   | boss       | re-reads every merge and judges the example captures; reopens the issue on a defect                                                                                                                      | edits code, merges        |
| Architect            | `/loop /t3d-architect` | boss       | rounds through compiler, engine, site, scripts; writes findings as To-do items on the domains' issues, which the leads implement                                                                         | codes, owns a PR          |
| Analyst              | `/loop /t3d-analyst`   | boss       | measures flow, returns and cost; proposes ranked process changes                                                                                                                                         | applies anything          |
| Writer               | `/t3d-writer`          | CTO only   | writes an issue on the template                                                                                                                                                                          | codes                     |

## How work flows

1. The boss tells the CTO what matters. The CTO sets the priority labels (🔴 🟠 🟡 🟢) of the
   issues concerned, each owned by one lead.
2. Each lead takes, in order:
   - its open pull requests;
   - its `measure ko` / `audit ko` issues;
   - then its issues by priority label (AGENTS.md §Leads).
3. For each issue, the lead runs one coder, who opens a draft PR, then one reviewer. It then
   writes `## Lead verification` in the PR, one line per To-do item, runs `gh pr ready`, and
   tells the CTO once CI is green; the CTO merges it.
   CI refuses a PR out of draft without that section, and any PR without real `/simplify:` and
   `/code-review:` lines.
4. After the merge:
   - the issue closes;
   - measurement and acceptance check it, and reopen it with `measure ko` / `audit ko` if needed.
5. Limits at every moment:
   - each lead within the limits of AGENTS.md §Leads;
   - one lead per issue, and nobody idle;
   - no leftover worktree or branch.

Quality is measured, not assumed. The CTO tracks, for each lead, the share of merges that come
back from acceptance. Above 1 in 10, the lead gets a second reviewer; if it stays there, it is
stopped.

## Running it

- **Once per clone:** `pnpm install`. It aliases the company's skills and agents from
  [`skills/`](../skills/) into your local `.claude/` (`pnpm run skills:link` does it again), so every clone
  runs the same way, including in the worktrees the desktop app creates. Edit a skill in
  `skills/`, never in `.claude/`.
- **Each morning:** open one Claude Code session on the repository and type `/t3d-cto`. The CTO
  gives you one prompt per session to open (a lead per domain with work, and the other roles
  that have work): open each and paste it.
- **During the day:** talk only to the CTO; watch the issues; test the examples.
- **In the evening:** tell the CTO to stop. Every agent finishes its current task, cleans its
  worktrees and branches, and stops; close the CTO session only once it says all have ended.
