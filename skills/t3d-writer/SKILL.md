---
name: t3d-writer
description: Writes one issue on the house template, when the boss asks or for a defect no issue covers. /t3d-writer <subject>.
argument-hint: <what the issue is about>
---

Write the issue for: **$ARGUMENTS**.

1. Search first (`gh issue list --state all --search …`): an open issue that covers it gets a To-do
   item instead.
2. One subject, on `.github/ISSUE_TEMPLATE/task.md`: **Why**, **To do**
   (what, never how), **Cost and target** (engine work: the cost formula and an absolute number),
   **Code context** (`path:line` to reuse), **Proof** (one item per line, each
   with a distinct start: the pull request quotes it and the CI checks it), **Links**.
3. Title: the outcome ("Shadows stay stable while the camera moves"). One domain label, one priority
   label.
4. Show the boss the title and the To do in French before `gh issue create`, unless he asked for it
   in those words; the recette opens its defects directly. Return the issue URL.
