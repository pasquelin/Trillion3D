#!/bin/sh
# Shared by the tracked git hooks: every change reaches develop/main through an issue and a
# pull request, whoever (or whatever) types the command. Installed by `pnpm install`
# (`git config core.hooksPath .githooks`). Each hook ends by delegating to the hook of the same
# name that a tool installed in .git/hooks (graphify), so core.hooksPath hides nothing.

refuse() {
  printf 'git hook: %s\n' "$1" >&2
  exit 1
}

# $1 = hook name, then the hook's own arguments; stdin is forwarded as received. Hooks live in
# the common dir (also from a linked worktree); --git-path would answer with core.hooksPath.
run_local_hook() {
  local_hook="$(git rev-parse --git-common-dir)/hooks/$1"
  shift
  [ -x "$local_hook" ] || return 0
  "$local_hook" "$@"
}
