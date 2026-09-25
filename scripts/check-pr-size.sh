#!/bin/sh
# Refuses a pull request that adds more than 600 hand-written lines (AGENTS.md rule 11: small,
# short-lived pull requests). Paths marked `linguist-generated` or `linguist-vendored` in
# .gitattributes are left out, as the base marks them (a pull request cannot exempt its own
# files), and binary files count no line. The whole repository is counted, from any folder.
# Usage: check-pr-size.sh [base]  (default $TRILLION3D_BASE_REF, as check:changed, else
# origin/develop; the CI passes the base of its merge commit).
set -eu
limit=600
base=${1:-${TRILLION3D_BASE_REF:-origin/develop}}
# Captured first: a failing diff then stops the script instead of counting zero lines.
stat=$(git --attr-source="$base" diff --numstat "$base"...HEAD -- ':/' \
  ':(top,exclude,attr:linguist-generated)' ':(top,exclude,attr:linguist-vendored)')
added=$(printf '%s\n' "$stat" | awk '{ n += $1 } END { print n + 0 }')
echo "Hand-written lines added: $added (limit $limit)."
[ "$added" -le "$limit" ] || {
  echo "Above the limit of AGENTS.md rule 11: split the pull request, \`Part of #n\`." >&2
  exit 1
}
