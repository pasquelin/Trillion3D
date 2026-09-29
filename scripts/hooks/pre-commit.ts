// Commits belong on a branch named <issue>-<short-name>, then the local pre-commit hook runs.
import { git, refuse, runLocalHook } from './lib.ts';

// symbolic-ref names the branch even before its first commit; it prints nothing when detached
// (rebase, bisect, cherry-pick in progress), which is allowed.
const branch = git('symbolic-ref', '--short', '-q', 'HEAD');
if (branch && !/^[0-9]+-/.test(branch))
  refuse(
    'commits belong on a branch named <issue>-<short-name>, cut from develop for one GitHub issue.',
  );
runLocalHook('pre-commit', process.argv.slice(2));
