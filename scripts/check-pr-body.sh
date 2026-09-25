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
if printf '%s\n' "$body" | grep -Eq '^Closes #[0-9]+' && printf '%s\n' "$body" | grep -Eq 'Part of #[0-9]+'; then
  echo 'The body says both "Closes" and "Part of": say "Part of #<issue>" unless every To-do item is delivered.' >&2
  exit 1
fi
review=$(printf '%s\n' "$body" | sed -n '/^## Local review before push/,/^## /p' | sed '1d;/^## /d')
[ -n "$(printf '%s' "$review" | tr -d '[:space:]')" ] || {
  echo 'The section "Local review before push" is empty: run the simplification and correctness passes first.' >&2
  exit 1
}
# A thumbnail-only pull request carries no code to review.
case "$body" in *'Thumbnail only'*) exit 0 ;; esac
lead=$(printf '%s\n' "$body" | sed -n '/^## Lead verification/,/^## /p' | sed '1d;/^## /d')
printf '%s\n' "$lead" | grep -Eq '^[-*] .+: (delivered|not delivered)' || {
  echo 'The section "Lead verification" is missing or empty: the lead maps every To-do item to its file and test before merging.' >&2
  exit 1
}
for skill in /simplify /code-review; do
  printf '%s\n' "$review" | grep -Eq "^[-* ]*\`?${skill}\`?:" || {
    echo "The section \"Local review before push\" has no \"${skill}:\" line: invoke the real ${skill#/} skill and copy its findings." >&2
    exit 1
  }
done
