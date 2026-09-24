#!/bin/sh
# Refuses a pull request body that does not start with "Closes #<issue>" or "Part of #<issue>"
# (a remainder stays in its issue, AGENTS.md rule 5), or whose
# "Local review before push" section is empty once HTML comments are removed.
# Usage: check-pr-body.sh < body  (the CI feeds it the pull request body).
set -u
body=$(perl -0pe 's/<!--.*?-->//gs')
printf '%s\n' "$body" | grep -Eq '^(Closes|Part of) #[0-9]+' || {
  echo 'The body must start with "Closes #<issue>" or "Part of #<issue>".' >&2
  exit 1
}
section=$(printf '%s\n' "$body" | sed -n '/^## Local review before push/,/^## /p' | sed '1d;/^## /d' | tr -d '[:space:]')
[ -n "$section" ] || {
  echo 'The section "Local review before push" is empty: run the simplification and correctness passes first.' >&2
  exit 1
}
