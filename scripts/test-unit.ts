import { spawnSync } from 'node:child_process';
import { repositoryFiles } from './repository-files.ts';

const unitTest =
  /^(?:packages\/sdk-(?:core|browser|node)\/src(?:\/[\w-]+)*|scripts|bench\/(?:runner(?:\/scenes)?|core)|tests(?:\/integration|\/browser|\/kit\/server)?)\/[^/]+\.test\.ts$/;
const found = repositoryFiles();
if (!found) throw new Error('Not a Git repository.');
const files = found.filter((file) => unitTest.test(file));
if (!files.length) throw new Error('No maintained unit tests found.');
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
