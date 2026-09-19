#!/bin/sh
# Shared by the tracked git hooks: every change reaches develop/main through an issue and a
# pull request, whoever (or whatever) types the command. Installed by `pnpm install`
# (`git config core.hooksPath .githooks`).

refuse() {
  printf 'git hook: %s\n' "$1" >&2
  exit 1
}

current_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null
}

is_protected() {
  case "$1" in
    develop|main) return 0 ;;
    *) return 1 ;;
  esac
}

# Runs the hook graphify (or any other tool) installed in .git/hooks under the same name.
run_local_hook() {
  local_hook="$(git rev-parse --git-dir)/hooks/$1"
  shift
  [ -x "$local_hook" ] && "$local_hook" "$@"
  return 0
}
