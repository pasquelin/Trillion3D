---
name: t3d-writer
description: Writes one issue on the house template; CTO only. /t3d-writer <subject>.
argument-hint: <what the issue is about>
---

Write the issue for: **$ARGUMENTS**.

1. `AGENTS.md` is already in your context; follow `docs/roles/writer.md`, to the letter: search first, map what
   exists, one subject per issue, its pattern, its title and labels.
2. Only the CTO session uses this skill; any other session refuses and reports the need to the
   CTO in one line. The CTO shows the boss the title and the "To do" in French in five lines
   before `gh issue create`, unless the boss already asked for it in those words.
3. Return the issue URL, one line.

## Context economy

Read only your role file and the issue at hand. Query GitHub with `--json … --jq` for counts and
states, never whole diffs, logs or transcripts; delegate a deep read to a bounded subagent.
