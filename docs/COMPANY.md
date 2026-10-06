# How Trillion3D is built: the company

Trillion3D is developed by AI sessions run by one person, the **boss** (the maintainer). The rules
are in [AGENTS.md](../AGENTS.md); each skill is one file in [`skills/`](../skills/). A contributor
who does not use an AI assistant can ignore this page.

| Session | Started with | Does |
| --- | --- | --- |
| Dev | an issue number | carries the issue to its merge (CONTRIBUTING.md "Contribution workflow") |
| Recette | `/loop 2h /t3d-recette` | its own session: times `develop` on the GPU bench, then proves its image |
| Writer | `/t3d-writer` | writes an issue on the template |
| Analyst | `/t3d-analyst` | on request: where the work loses time |
| Architect | `/t3d-architect` | on request: duplicates and bloat as To-do items |

## Running it

- **Once per clone:** `pnpm install`; it links `skills/` into your local `.claude/`
  (`pnpm run skills:link` does it again). Edit in `skills/`, never in `.claude/`.
- **Each day:** one session per issue you hand out, one session `/loop 2h /t3d-recette`.
- **In the evening:** tell them to stop; close the sessions once they say all is clean.
