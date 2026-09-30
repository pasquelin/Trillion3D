import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cleanBundle } from './build-bundle.ts';
import { heavyStep } from './heavy-lock.ts';
import { run } from './run.ts';

// `pnpm run build`: the packages' `dist/`, from a clean output, as one heavy step
// (`scripts/heavy-lock.ts`).
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const steps: string[][] = [
  [tsc, '-p', 'tsconfig.json'],
  ['scripts/rewrite-dts-extensions.ts'],
  ['scripts/copy-resources.ts'],
  ['scripts/write-build-provenance.ts'],
  ['scripts/build-bundle.ts'],
  ['scripts/build-witnesses.ts'],
];

heavyStep('build', () => {
  for (const pkg of ['sdk', 'sdk-core', 'sdk-browser', 'sdk-node', 'witnesses'])
    rmSync(`dist/${pkg}`, { recursive: true, force: true });
  if (existsSync('dist')) cleanBundle('dist');
  for (const args of steps) run(process.execPath, args);
});
