import { spawnSync } from 'node:child_process';
import { pnpmCommand } from './only-pnpm.mjs';
import { NATIVE_STEPS, stepsToRun } from './validate-steps.mjs';

const steps = stepsToRun(process.env);
const skipped = [...NATIVE_STEPS].filter((step) => !steps.includes(step));
if (skipped.length)
  console.log(
    `Native steps skipped, binaries restored for unchanged Rust sources: ${skipped.join(', ')}`,
  );

for (const step of steps) {
  const result = spawnSync(...pnpmCommand('run', step), { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
