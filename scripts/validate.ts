import { spawnSync } from 'node:child_process';
import { pnpmCommand } from './only-pnpm.ts';
import { NATIVE_STEPS, skipsNative, stepsToRun } from './validate-steps.ts';

if (skipsNative(process.env))
  console.log(
    `Native steps skipped, binaries restored for unchanged Rust sources: ${NATIVE_STEPS.join(', ')}`,
  );

for (const step of stepsToRun(process.env)) {
  const result = spawnSync(...pnpmCommand('run', step), { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
