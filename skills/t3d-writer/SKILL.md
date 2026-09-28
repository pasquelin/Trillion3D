---
name: t3d-writer
description: Writes one issue on the house template; CTO, recette or measure only. /t3d-writer <subject>.
argument-hint: <what the issue is about>
---

Write the issue for: **$ARGUMENTS**. Only a CTO, recette or measure uses this skill; any other agent
refuses and reports the need to a CTO in one line.

1. Search first (`gh issue list --state all --search …`): an open issue that covers it gets a To-do
   item instead.
2. One subject, sized for one pull request, on `.github/ISSUE_TEMPLATE/task.md`: **Why**, **To do**
   (what, never how), **Code context** (`path:line` to reuse), **Proof**, **Links**.
3. Title: the outcome ("Shadows stay stable while the camera moves"). One domain label, one priority
   label.
4. A CTO shows the boss the title and the To do in French before `gh issue create`, unless he asked
   for it in those words; recette and measure open their defects directly. Return the issue URL.
