# Role: writer

Anyone can take this role: the maintainer for a new feature, the measurer for a regression, the
auditor for a finding, a chef for a subject found too large. "Follow `docs/roles/writer.md`:
<what the issue is about>". You write issues; you never code, never measure. Every issue is in
English, on `.github/ISSUE_TEMPLATE/task.md`.

## Before writing

1. **Search first.** `gh issue list --state all --search "<keywords>"`. An open issue on the same
   subject is enriched (`gh issue comment` or `gh issue edit --body-file`), never duplicated.
2. **Map what exists.** Find the functions, modules and docs the work touches (the knowledge graph
   first, then a bounded search). Every one goes in "Code context": the coder reuses them, never
   rebuilds them (AGENTS.md rule 6).
3. **One subject per issue.** More than one subject, or more than a coder can finish in one pull
   request: a parent issue that lists its children, one child per subject, each closable alone.

## The five sections

- **Why** — the problem as the user or the frame sees it, in two to four sentences. A number when
  one exists (ms, bytes, pixels), with the machine and the commit.
- **To do** — one bullet per deliverable, each starting with a bold name. What, never how: the
  technique is the coder's, the outcome is the issue's. No bullet the proof does not check.
- **Code context** — `path:line` of what exists and is reused, and what must not be duplicated.
- **Proof** — what closes the issue: the tests by behaviour, the gates, the browser proof and the
  bench scene the measurer will run after the merge, the before/after expected.
- **Links** — `Parent #`, `Blocked by #`, `Related #`, `Regression after #` or `Audit of #`.

## Title and labels

- Title: the outcome, not the activity — "Shadows stay stable while the camera moves", never
  "Work on shadows". A child of a parent: `<Parent name> <k>/<n>: <outcome>`. A regression:
  `Regression after #<n>: <what degraded>`. A finding: `Audit of #<pr>: <what is wrong>`.
- Labels: exactly one domain label (`geometry`, `lighting`, `textures`, `compiler`,
  `calculator`, `benchmarking`, `physics`, `bug`, `documentation`…), exactly one priority
  (`🔴 critical` … `🟢 low`), plus `measure ko` or `audit ko` when it comes from them. The domain
  label is what routes the issue to its chef.
- "Blocked by" is also set natively:
  `gh api -X POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -f issue_id=<id>`.

## Patterns

| Pattern    | Written by       | Why holds                                 | Proof holds                            |
| ---------- | ---------------- | ----------------------------------------- | -------------------------------------- |
| feature    | maintainer, chef | what the user cannot do today             | tests, example, measured scene         |
| bug        | anyone           | what is observed, how to reproduce        | a test that fails before, passes after |
| regression | measurer         | before/after numbers, captures, the merge | the measurer's run, back to before     |
| finding    | auditor          | the rule broken, file:line                | the rule held, gate or test named      |
| parent     | maintainer, chef | the whole goal, its order                 | every child closed                     |

## Example — a regression, as the measurer writes it

**Title:** `Regression after #402: frame time +1.8 ms on the facade scene`
**Labels:** `geometry`, `🟠 high`, `measure ko`

```markdown
## Why

After #402 merged (`a1b2c3d`), the facade scene renders 1.8 ms slower per frame, beyond the
0.3 ms run-to-run spread. Apple M2, Chrome 131, DPR 2, 1920×1080, error 1 px, display cap 120 Hz.
The image is unchanged: 0 px against the first parent.

| Metric            | Before (`9f8e7d6`) | After (`a1b2c3d`) |
| ----------------- | ------------------ | ----------------- |
| Frame envelope    | 6.1 ms             | 7.9 ms            |
| Selected clusters | 41 210             | 41 210            |

## To do

- **Find the cost.** Read the CPU step profile before and after, name the step that grew.
- **Restore the frame.** The envelope returns within the spread of 6.1 ms, same image.

## Code context

- `packages/sdk-browser/src/webgpu/pages/render/cpuSteps.ts` — the per-step profile to read.
- The diff of #402: `gh pr diff 402`.

## Proof

- The measurer's run on the facade scene: envelope within the spread of the before side, 0 px.
- Gates: `check:changed`, `test:changed`, `validate`.

## Links

Regression after #402.
```
