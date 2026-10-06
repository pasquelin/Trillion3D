import { readFileSync } from 'node:fs'
import { isCodeChange } from './changed-steps.ts'

// `git diff --name-only … | node scripts/code-change.ts` prints `code=true` when the change touches
// anything but documentation, site images or translations, and `code=false` otherwise: the CI then
// skips its code jobs and still reports `validate` (`.github/workflows/quality.yml`). An empty list
// is read as code, so a diff that could not be taken never skips a gate.
const paths = readFileSync(0, 'utf8').split('\n').filter(Boolean)
console.log(`code=${isCodeChange(paths)}`)
