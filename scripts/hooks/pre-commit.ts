// Commits belong on a branch named <issue>-<short-name>; the staged files are formatted
// (`scripts/format-staged.ts`), then the local pre-commit hook runs.
import { git } from '../git-paths.ts'
import { gate, refuse, runLocalHook } from './lib.ts'

// The current branch, named even before its first commit; nothing when detached (rebase, bisect,
// cherry-pick in progress), which is allowed.
const branch = git('.', 'branch', '--show-current')
if (branch && !/^[0-9]+-/.test(branch))
  refuse(
    'commits belong on a branch named <issue>-<short-name>, cut from develop for one GitHub issue.',
  )
gate('node', ['scripts/format-staged.ts'])
runLocalHook('pre-commit', process.argv.slice(2))
