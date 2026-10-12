// Commits belong on a branch named <issue>-<short-name>; the staged files are formatted
// (`scripts/format-staged.ts`), then the local pre-commit hook runs.
import { git } from '../git-paths.ts'
import { gate, refuse, runLocalHook } from './lib.ts'

// symbolic-ref names the branch even before its first commit; it fails when detached (rebase,
// bisect, cherry-pick in progress), which is allowed.
let branch = ''
try {
  branch = git(process.cwd(), 'symbolic-ref', '--short', '-q', 'HEAD')
} catch {
  // Detached: no branch to name.
}
if (branch && !/^[0-9]+-/.test(branch))
  refuse(
    'commits belong on a branch named <issue>-<short-name>, cut from develop for one GitHub issue.',
  )
gate('node', ['scripts/format-staged.ts'])
runLocalHook('pre-commit', process.argv.slice(2))
