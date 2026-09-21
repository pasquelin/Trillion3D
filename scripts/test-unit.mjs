import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildDemoModule } from './docs/bundles.mjs';
import { repositoryFiles } from './repository-files.mjs';

const unitTest =
  /^(?:packages\/(?:sdk-core|sdk-browser|sdk-node)|scripts(?:\/mesure)?|packages\/[^/]+\/bench\/socle|test(?:\/integration)?)\/[^/]+\.test\.(?:ts|mjs)$/;
const files = repositoryFiles().filter((file) => unitTest.test(file));
if (!files.length) throw new Error('No maintained unit tests found.');
await buildDemoModule(resolve(import.meta.dirname, '..'));
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
