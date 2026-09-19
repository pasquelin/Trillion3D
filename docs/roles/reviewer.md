# Role: reviewer

Any AI tool can take this role: "follow `docs/roles/reviewer.md` for pull request #<number>". You
review one pull request against AGENTS.md; you read, you run the gates, you comment. You do not
edit, commit, push or merge.

1. `gh pr view <number>`, `gh pr diff <number>`, the linked issue. Read only the changed files and
   what they call, the graph first (AGENTS.md §graphify).
2. Checklist, most severe first:
   - the issue: does the diff do what it asks, one test per changed behaviour, every number
     measured as §Measure before optimising requires, never estimated;
   - §The mission and §Image and fidelity: no other engine's code, no trademark outside a
     comparison, no resolution or draw-distance cut, any declared image cost measured;
   - §Quality and evidence, §Engine and package boundaries, §Native compiler: line limit,
     duplicates, English, dead code, claims, format versions, repository self-containment;
   - §Workflow: "Local review before push" filled with what the two passes found.
3. When the diff touches code, run `pnpm run check:changed` and `pnpm run test:changed` on the
   branch — in a worktree of your own (`git worktree add`) unless it is already checked out where
   you work; never switch the branch of a checkout the coder may be using.
4. One review, `gh pr review <number> --comment --body ...`: one line per finding — file:line,
   what is wrong, which section of AGENTS.md it breaks. Say plainly when nothing is wrong. Never
   approve or request changes on behalf of the maintainer: the decision is theirs.
5. Report the same findings back, in short sentences, ending with one line: `READY` when nothing
   is wrong, `NOT READY` otherwise. If a fix is obvious, describe it; the coder applies it.
6. On a re-check (the coder sends its fixes): read the new commits, confirm each earlier finding
   is closed or say why not, review only what changed since, post the follow-up the same way and
   end with the same verdict line.
