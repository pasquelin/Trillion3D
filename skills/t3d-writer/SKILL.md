---
name: t3d-writer
description: Writes one issue on the house template; CTO only. /t3d-writer <subject>.
argument-hint: <what the issue is about>
---

Write the issue for: **$ARGUMENTS**. Follow `docs/roles/writer.md` to the letter. Only a CTO uses
this skill; any other agent refuses and reports the need to a CTO in one line. The CTO shows the
boss the title and the "To do" in French before `gh issue create`, unless he asked for it in those
words. Return the issue URL.
