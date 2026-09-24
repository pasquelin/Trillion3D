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
   names the issue, the files to read and nothing else. It returns a pull request.
   `gh issue edit <n> --remove-label "in progress" --add-label "in review"`.
3. **Review.** Launch one `reviewer` subagent with a fresh context on the pull request
   (`docs/roles/reviewer.md`). `KO`: send its findings to a new coder with a short brief, then
   review again. Three rounds at most; past that, report to the maintainer and stop.
4. **Merge.** With the reviewer's `OK`: bring the branch up to date with `develop`
   (`gh pr update-branch <pr>`), wait for `validate` to be green on that head
   (`gh pr checks <pr> --watch`), then `gh pr merge <pr> --merge --delete-branch`. A red check goes back to step 3.
5. **Hand over.** `gh issue edit <n> --remove-label "in review"`, add `to measure` for an engine
   batch (`packages/`, compiler, format, shaders, a published number), then `gh issue close <n>`.
   The measurer and the auditor never hold the issue open.
   Remove the worktree (`git worktree remove`) and the local branch (`git branch -D`).
6. **Report** to the maintainer in two lines: issue, pull request, verdict. Then back to step 1,
   until the domain has nothing left.

## Bounds

- One issue at a time, one subagent alive at a time.
- A subagent never launches its own subagents. A finished one is stopped.
- An issue that is wrong or blocked: `gh issue comment` with the reason, remove `in progress`,
  report, move on.
