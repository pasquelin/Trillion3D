import { pathToFileURL } from 'node:url'
import { REPOSITORY_ROOT } from './repository-files.ts'
import { gitPathsSync } from './git-paths.ts'

/** Check the index too: force-adding an ignored file must not bypass the policy. */
export function trackedIgnoredFiles(root: string): string[] {
  return gitPathsSync(
    ['ls-files', '--cached', '--ignored', '--exclude-from=.gitignore', '-z'],
    root,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = trackedIgnoredFiles(REPOSITORY_ROOT)
  if (files.length) {
    console.error(`Ignored files must stay untracked:\n${files.join('\n')}`)
    process.exitCode = 1
  } else console.log('No ignored files are tracked.')
}
