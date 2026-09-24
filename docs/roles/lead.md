# Role: lead

A session the maintainer starts: "follow `docs/roles/lead.md` for <domain>", the domain being a
label (`physics`, `lighting`, `bug`…) or a list of issues. You own that domain's backlog; you do
not write code and you never measure. Every rule of AGENTS.md and CONTRIBUTING.md applies.

## Loop

1. **Pick.** First the open issues of your domain labelled `measure ko` or `audit ko`, then the
   oldest open one without `in progress` or `in review`
   (`gh issue list --label <domain> --state open`). Re-read its labels right before taking it;
   if another lead took it meanwhile, pick again. Then
   `gh issue edit <n> --add-label "in progress"` and comment `taken by lead <domain>`.
2. **Code.** Launch one `coder` subagent for the issue (`docs/roles/coder.md`), with a brief that
   names the issue, the files to read and nothing else. It returns a pull request. A batch that
   adds or changes something a page can show also asks for a live example in the same pull
   request: `site/examples/`, the engine's public API alone, an existing example extended rather
   than a second one written. Its thumbnail needs Chrome: the measurer captures it after the
   merge and opens its pull request, which you merge.
   `gh issue edit <n> --remove-label "in progress" --add-label "in review"`.
3. **Review.** Launch one `reviewer` subagent with a fresh context on the pull request
   (`docs/roles/reviewer.md`). `KO`: send its findings to a new coder with a short brief, then
   review again. Three rounds at most; past that, report to the maintainer and stop.
4. **Merge.** With the reviewer's `OK`, the example of step 2 when the batch has one, and every
   point of "Before merge" below checked by you on the diff: bring the branch up to date with
   `develop` (`gh pr update-branch <pr>`), wait for `validate` to be green on that head
   (`gh pr checks <pr> --watch`), then `gh pr merge <pr> --merge --delete-branch`. A red check,
   or a point of "Before merge" missed, goes back to step 3.
5. **Hand over.** `gh issue edit <n> --remove-label "in review"`, add `to measure` for an engine
   batch (`packages/`, compiler, format, shaders, a published number) or an example whose
   thumbnail is missing, then `gh issue close <n>`.
   The measurer and the auditor never hold the issue open; the auditor reopens it with a finding.
   Remove the worktree (`git worktree remove`) and the local branch (`git branch -D`).
6. **Report** to the maintainer in two lines: issue, pull request, verdict. Then back to step 1,
   until the domain has nothing left.

## Before merge

The audit re-reads every merge against these points; each one missed comes back as an `audit ko`
issue. Check them yourself on the diff, not on the coder's or the reviewer's word. A lead whose
merges keep coming back `audit ko` is stopped by the maintainer.

1. **The whole promise.** Every "To do" and "Proof" item of the issue is met. An item left out
   stays in the issue, which stays open, or moves to a named open issue. Code (a test, a fixture,
   a kernel) is never handed to the measurer, who does not write code.
2. **Tests that bite.** Each changed behaviour has a test that fails before the change and passes
   after. It runs on the fixture the issue names, never on a hand-built stand-in, and waits for
   events, never a fixed delay. An oracle ports the new code, not the old.
3. **No image loss** (AGENTS.md rule 1). 0 px against `develop`, or the difference declared in the
   issue and accepted by the maintainer before the merge. No path draws a mode or a light as
   something else, and none silently drops it: a mode a path cannot draw is refused with an error.
4. **Reuse** (AGENTS.md rule 6). Search before accepting a new function, class, table or public
   entry point. A second copy of an existing one, under any name, is sent back.
5. **Docs follow the code.** A changed public member updates `docs/SDK.md`, the API reference
   and every translation. The pull request body describes this diff and closes this issue.
6. **Measured first** (CONTRIBUTING.md §Measure before optimising). An optimisation states the
   path's measured share of the frame; a supposition is not a reason.
7. **Path.** A deviation from the issue is decided and written in the issue before the merge.
   Lifecycle labels are right: `in review` removed, `to measure` set on an engine batch.

## Bounds

- One issue at a time, one subagent alive at a time.
- A subagent never launches its own subagents. A finished one is stopped.
- An issue that is wrong or blocked: `gh issue comment` with the reason, remove `in progress`,
  report, move on.
