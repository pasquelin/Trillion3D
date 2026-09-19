import { spawnSync } from 'node:child_process';
import { pnpmCommand } from './only-pnpm.mjs';

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
  'check:docs-demo',
  'check:links',
  'test',
  'test:native',
];

for (const step of steps) {
  const result = spawnSync(...pnpmCommand('run', step), { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
