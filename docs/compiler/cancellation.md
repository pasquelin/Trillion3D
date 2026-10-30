# Cancellation

Write `{"cancel": "*"}` or `{"cancel": "<job id>"}` as one line on stdin: the job stops at its next
step and emits `cancelled`; unstarted batch jobs still run unless `"*"` was sent. Killing the
process is safe too: every file is written under a temporary name and renamed, so the cache holds
the previous or the new result, and a re-run reuses the finished import.
