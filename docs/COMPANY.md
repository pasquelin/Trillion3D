# How Trillion3D is built: the company

Trillion3D is developed by a small "company" of AI agents run by one person, the **boss** (the
maintainer). The rules and who starts whom are in [AGENTS.md](../AGENTS.md); each role is one file:
a skill in [`skills/`](../skills/) or an agent in [`skills/agents/`](../skills/agents/). A
contributor who does not use an AI assistant can ignore this page.

| Role | File | Started by | Does |
| --- | --- | --- | --- |
| CTO | `/t3d-cto` | boss | one dev team: two issues at a time, each through a lead, to merge |
| Lead | agent `lead` | CTO | runs its coder then its reviewer, opens the pull request, cleans |
| Coder | agent `coder` | lead | writes the code on a branch and pushes it |
| Reviewer | agent `reviewer` | lead, CTO | `simplify`, `code-review`, the issue's To-do, the gates and tests |
| Recette | `/loop 2h /t3d-recette` | boss | its own session: times `develop`, then proves its image |
| Writer | `/t3d-writer` | CTO, recette | writes an issue on the template |
| Architect | `t3d-architect` | CTO | on request: duplicates and bloat as To-do items |
| Analyst | `t3d-analyst` | CTO | on request: where the company loses time |

## Running it

- **Once per clone:** `pnpm install`; it links `skills/` into your local `.claude/`
  (`pnpm run skills:link` does it again). Edit in `skills/`, never in `.claude/`.
- **Each morning:** one session `/t3d-cto` per dev team you want (any assistant can be one), one
  session `/loop 2h /t3d-recette`.
- **During the day:** talk to the CTOs; test the examples.
- **In the evening:** tell them to stop; close the sessions once they say all is clean.
