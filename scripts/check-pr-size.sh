#!/bin/sh
# Refuses a pull request that adds more than 600 hand-written lines (AGENTS.md rule 11:
# small, short-lived pull requests). Paths marked `linguist-generated` in .gitattributes are left
# out, and binary files count no line.
# Usage: check-pr-size.sh [base]  (default origin/develop; the CI passes the base of its merge commit).
set -eu
limit=600
base=${1:-origin/develop}
# Captured first: a failing diff then stops the script instead of counting zero lines.
stat=$(git diff --numstat "$base"...HEAD -- . ':(exclude,attr:linguist-generated)')
added=$(printf '%s\n' "$stat" | awk '{ n += $1 } END { print n + 0 }')
echo "Hand-written lines added: $added (limit $limit)."
[ "$added" -le "$limit" ] || {
  echo "Above the limit of AGENTS.md rule 11: split the pull request, \`Part of #n\`." >&2
  exit 1
}
