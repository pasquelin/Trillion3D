import { spawnSync } from 'node:child_process';
import { pnpmCommand } from './only-pnpm.ts';
import { NATIVE_STEPS, skipsNative, stepsToRun } from './validate-steps.ts';

// `validate` runs every gate; `validate --group <name>` runs one group, which is how the CI gives
// each of them its own parallel job (`.github/workflows/quality.yml`).
const groupFlag = process.argv.indexOf('--group');
const group = groupFlag === -1 ? undefined : process.argv[groupFlag + 1];

if (skipsNative(process.env))
  console.log(
    `Native steps skipped, binaries restored for unchanged Rust sources: ${NATIVE_STEPS.join(', ')}`,
  );

for (const step of stepsToRun(process.env, group)) {
  const result = spawnSync(...pnpmCommand('run', step), { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
