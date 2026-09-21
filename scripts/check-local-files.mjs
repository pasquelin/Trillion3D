import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUNDLES } from './docs/bundles.mjs';

/** Ignored everywhere, tracked on main alone: the release commits them there by design. */
const RELEASE_BUNDLES = new Set(BUNDLES.map((bundle) => `docs/${bundle}`));

/** Check the index too: force-adding an ignored file must not bypass the policy. */
export function trackedIgnoredFiles(root) {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--ignored', '--exclude-from=.gitignore', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => file && !RELEASE_BUNDLES.has(file));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = trackedIgnoredFiles(resolve(import.meta.dirname, '..'));
  if (files.length) {
    console.error(`Ignored files must stay untracked:\n${files.join('\n')}`);
    process.exitCode = 1;
  } else console.log('No ignored files are tracked.');
}
