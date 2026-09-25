import { spawnSync } from 'node:child_process';
import { generateApiFiles } from './generate-api-reference.ts';
import { repositoryFiles } from './repository-files.ts';
import { compileSiteCaches } from './site-caches.ts';
import { isUnitTest } from './unit-tests.ts';

const found = repositoryFiles();
if (!found) throw new Error('Not a Git repository.');
const files = found.filter(isUnitTest);
if (!files.length) throw new Error('No maintained unit tests found.');
await generateApiFiles();
compileSiteCaches();
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
