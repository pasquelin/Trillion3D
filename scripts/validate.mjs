import { spawnSync } from 'node:child_process';

const steps = [
  'format:check',
  'check:lines',
  'check:duplicates',
  'lint',
  'check:unused',
  'build',
  'build:native',
  'check:structure',
  'check:dts',
  'check:links',
  'test',
  'test:native',
];

/** Le gestionnaire du dépôt, et lui seul : `pnpm.cmd` sous Windows, où `spawnSync` n'exécute pas un
 *  script sans extension. Lancer `npm` ici ferait tourner les étapes sous un autre installeur que
 *  celui qui a posé `node_modules`. */
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

for (const step of steps) {
  const result = spawnSync(pnpm, ['run', step], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
