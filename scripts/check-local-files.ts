import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Check the index too: force-adding an ignored file must not bypass the policy. */
export function trackedIgnoredFiles(root: string): string[] {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--ignored', '--exclude-from=.gitignore', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = trackedIgnoredFiles(resolve(import.meta.dirname, '..'));
  if (files.length) {
    console.error(`Ignored files must stay untracked:\n${files.join('\n')}`);
    process.exitCode = 1;
  } else console.log('No ignored files are tracked.');
}
