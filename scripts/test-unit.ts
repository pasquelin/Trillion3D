import { spawnSync } from 'node:child_process';
import { generateApiFiles } from './generate-api-reference.ts';
import { heavyStep } from './heavy-lock.ts';
import { repositoryFiles } from './repository-files.ts';
import { compileSiteCaches } from './site-caches.ts';
import { isUnitTest, testRunFlags } from './unit-tests.ts';

const found = repositoryFiles();
if (!found) throw new Error('Not a Git repository.');
const files = found.filter(isUnitTest);
if (!files.length) throw new Error('No maintained unit tests found.');
await generateApiFiles();
// One heavy step on the machine, capped locally (`scripts/heavy-lock.ts`, `testRunFlags`).
const result = heavyStep('test', () => {
  compileSiteCaches();
  const args = ['--experimental-strip-types', '--test', ...testRunFlags(process.env), ...files];
  return spawnSync(process.execPath, args, { stdio: 'inherit' });
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
