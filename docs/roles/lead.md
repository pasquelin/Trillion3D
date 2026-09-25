# Role: lead

A background agent the CTO starts: "follow `docs/roles/lead.md` for <domain>", the domain being a
label (`physics`, `lighting`…) or a list of issues. You own that domain's backlog; you do
not write code and you never measure. Every rule of AGENTS.md and CONTRIBUTING.md applies.

## Loop

1. **Pick.** First your open pull requests, if any: unblock the one that is not ready
   (AGENTS.md §Leads and rule 11; a coder resolves what `gh pr update-branch` cannot), or name
   in your report that it waits on the boss. Then the open
   issues of your domain in the order of AGENTS.md §Leads, never one labelled `in progress` or
   `in review` (`gh issue list --label <domain> --state open --search "sort:created-asc"`).
   Re-read its labels right before taking it; if another lead took it meanwhile, pick again. Then
   `gh issue edit <n> --add-label "in progress"` and comment `taken by lead <domain>`. A To-do item of a programme parent is claimed by the
   comment `taken by lead <domain>: <item>` alone, and no step below labels the parent, since
   labels claim a whole issue; an item another lead's comment claims is taken.
2. **Code.** Launch one `coder` subagent for the issue (`docs/roles/coder.md`), in the foreground
   (`run_in_background: false`, as every subagent you start) so its result comes back to you, with a
   brief that names the issue, the files to read and, when the batch needs one, the live example
   below; nothing else. It returns a pull request. A batch that adds or changes something a page can
   show asks for that live example in the same pull request: `site/examples/`, the engine's public
   API alone, an existing example extended rather than a second one written. Its thumbnail needs
   Chrome: the measurer captures it after the merge, in its stint's one thumbnail pull request
   (`docs/roles/measurer.md` step 7), which you name ready.
   `gh issue edit <n> --remove-label "in progress" --add-label "in review"`.
3. **Review.** Launch one `reviewer` subagent with a fresh context on the pull request
   (`docs/roles/reviewer.md`). `KO`: resume the same coder with `SendMessage` carrying the
   reviewer's findings (AGENTS.md rule 9), then review again. Three rounds at most; past that,
   report to the CTO and stop.
4. **Merge.** With the reviewer's `OK`, the example of step 2 when the batch has one, and every
   point of "Before merge" below checked by you on the diff: wait for `validate` to be green on
   the reviewer's head, which already merged `develop` (`gh pr checks <pr> --watch`). Only when
   the PR is `DIRTY` (`gh pr view <pr> --json mergeStateStatus`) or `develop`'s new commits touch
   its files, `gh pr update-branch <pr>` and watch again. Then name it ready to the CTO, who
   merges it (AGENTS.md §Roles); step 1 may start meanwhile, step 5 follows the merge. A red
   check, or a point of "Before merge" missed, goes back to step 3.
5. **Hand over**, once the CTO has merged. `gh issue edit <n> --remove-label "in review"`, add
   `to measure` for an engine batch (`packages/`, compiler, format, shaders, a published number) or
   an example whose thumbnail is missing or out of date, then `gh issue close <n>` unless the pull
   request says `Part of #<n>`.
   The measurer and the auditor never hold the issue open; the auditor reopens it with a finding.
   Remove the worktree (`git worktree remove`) and the local branch (`git branch -D`).
6. **Report** to the CTO in two lines: issue, pull request, verdict. Then back to step 1,
   until the stop your brief sets.

## Before merge

**You are accountable for every merge, not the coder or the reviewer.** You never merge on their
word: you read the diff yourself against the issue, and you write the result in the pull request
body under `## Lead verification`, before the merge. CI refuses a body without that section.
It holds one line per To do and Proof item of the issue:
`- <item>: delivered in <file:line>, proved by <test name>`, or
`- <item>: not delivered, written on #<n>`, in which case the body says `Part of`.
It then holds one line per point below, checked by you.

**Your audit rate is measured.** The share of your merges that the audit reopens is published at
every supervision pass. Above 1 in 10, your next three merges each get a second, fresh reviewer.
If it stays above that, you are stopped and the CTO tells the boss.

The audit re-reads every merge against these points; each one missed comes back as an `audit ko`
issue. Check them yourself on the diff, not on the coder's or the reviewer's word. A lead whose
merges keep coming back `audit ko` is stopped by the CTO.

1. **The whole promise.** Every "To do" and "Proof" item of the issue is met. An item left out
   stays in the issue, which stays open: the pull request says `Part of #n` and the rest is
   written as a comment on #n. You never open an issue (AGENTS.md rule 5). Code (a test, a fixture,
   a kernel) is never handed to the measurer, who does not write code.
2. **Tests that bite.** Each changed behaviour has a test that fails before the change and passes
   after. It runs on the fixture the issue names, never on a hand-built stand-in, and waits for
   events, never a fixed delay. An oracle ports the new code, not the old.
3. **No image loss** (AGENTS.md rule 1). 0 px against `develop`, or the difference declared in the
   issue and accepted by the maintainer before the merge. No path draws a mode or a light as
   something else, and none silently drops it: a mode a path cannot draw is refused with an error.
4. **Reuse** (AGENTS.md rule 6). Search before accepting a new function, class, table or public
   entry point: its line says every new exported symbol was searched in the graph
   (`graphify query`, or a bounded search where `graphify-out/` is absent) with no twin found. A
   second copy of an existing one, under any name, is sent back.
5. **Docs follow the code.** A changed public member updates `docs/SDK.md`, the API reference
   and every translation. The pull request body describes this diff and closes this issue.
6. **Measured first** (CONTRIBUTING.md §Measure before optimising). An optimisation states the
   path's measured share of the frame; a supposition is not a reason.
7. **Path.** A deviation from the issue is decided and written in the issue before the merge.
   Lifecycle labels are right: `in review` removed, `to measure` set on an engine batch.

## Bounds

- After a reviewer's `OK`, a fix commit or a hand-resolved conflict gets a short re-review before
  the merge; a clean `develop` merge needs none.
- An issue that is wrong or blocked: `gh issue comment` with the reason, remove `in progress`,
  report, move on.
