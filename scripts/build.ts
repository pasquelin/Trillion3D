import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { heavyStep } from './heavy-lock.ts';

// `pnpm run build`: the packages' `dist/`, from a clean output, as one heavy step
// (`scripts/heavy-lock.ts`).
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const steps: string[][] = [
  [tsc, '-p', 'tsconfig.json'],
  ['scripts/rewrite-dts-extensions.ts'],
  ['scripts/copy-resources.ts'],
  ['scripts/write-build-provenance.ts'],
  ['scripts/build-witnesses.ts'],
];

heavyStep('build', () => {
  for (const pkg of ['sdk', 'sdk-core', 'sdk-browser', 'sdk-node', 'witnesses'])
    rmSync(`dist/${pkg}`, { recursive: true, force: true });
  for (const args of steps) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
});
