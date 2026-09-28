# How Trillion3D is built: the company

Trillion3D is developed by a small "company" of AI agents run by one person, the **boss** (the
maintainer). This page explains who does what. The rules live in [AGENTS.md](../AGENTS.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md); each role is written in [docs/roles/](roles/). A contributor
who does not use an AI assistant can ignore this page.

## The idea in one paragraph

The boss sets priorities and tests the result. He opens one or two **CTO** sessions (`oldest`,
`newest`). Each CTO carries **one issue at a time**: it picks the next issue of the backlog, hands
it to the **lead** of its domain, whose **coder** writes it and whose **reviewer** checks it on a
branch; **acceptance** proves the image and **measurement** times it on that branch; only then does
the lead open the pull request, which merges itself once CI is green, and the CTO picks the next
issue. The CTO passes the pull requests of the boss's other AI workers through the same review,
proof and timing. GitHub is the single source of truth: issues, labels and pull requests.

## The roles

| Role                 | Skill                     | Started by | Does                                                                                   |
| -------------------- | ------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Boss                 | —                         | —          | sets priorities, tests the result, approves what could lose quality                    |
| CTO                  | `/t3d-cto oldest\|newest` | boss       | picks one issue at a time, hands it to a lead, sends the branch to proof and timing    |
| Lead                 | `/t3d-lead <domain>`      | boss       | runs its coder then its reviewer, writes the Lead verification, opens the PR, closes   |
| Coder                | agent `coder`             | lead       | implements the issue on a branch and pushes it; runs no gate, test or Chrome           |
| Reviewer             | agent `reviewer`          | lead, CTO  | the real `simplify` and `code-review` skills, the acceptance list, the gates and tests |
| Acceptance (recette) | `/loop /t3d-recette`      | boss       | re-reads the branch and proves its image before the pull request                       |
| Measurement          | `/loop /t3d-measure`      | boss       | the only one timing: the branch before its pull request, budgets, thumbnails           |
| Architect            | `/loop /t3d-architect`    | boss       | finds duplicates and bloat, writes them as To-do items on the domains' issues          |
| Analyst              | `/loop /t3d-analyst`      | boss       | measures how the company works and proposes simplifications                            |
| Writer               | `/t3d-writer`             | CTO only   | writes an issue on the template                                                        |

## Running it

- **Once per clone:** `pnpm install`. It aliases the company's skills and agents from
  [`skills/`](../skills/) into your local `.claude/` (`pnpm run skills:link` does it again). Edit a
  skill in `skills/`, never in `.claude/`.
- **Each morning:** open a session and type `/t3d-cto oldest` (and, for a second one,
  `/t3d-cto newest`). Each CTO asks you for the sessions it needs; open each and paste it.
- **During the day:** talk only to the CTOs; test the examples.
- **In the evening:** tell the CTOs to stop; close their sessions once they say all is clean.
