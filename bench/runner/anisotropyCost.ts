// What anisotropic filtering costs the WebGPU engine (#360, #361): one floor with detail at every
// texel, seen at a grazing angle, drawn at each anisotropy asked — 1 and 16 by default — by the
// engine built under `dist/`, and the p50 GPU time of its images printed side by side. The page
// is `tests/browser/support/anisotropyCostPage.ts`; nothing outside this repository is read.
//
//   pnpm run build
//   node bench/runner/anisotropyCost.ts [--anisotropie 1,16] [--images 240]
//        [--largeur 1920] [--hauteur 1080] [--visible]
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './options.ts';
import { withRepoPage } from '../../tests/kit/server/repoPage.ts';
import type { run as runOnPage } from '../../tests/browser/support/anisotropyCostPage.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const flags = parseArgs(process.argv.slice(2));
const count = (name: string, fallback: number) => {
  const value = Number(flags.get(name) ?? fallback);
  assert.ok(Number.isInteger(value) && value > 0, `--${name} must be a positive integer`);
  return value;
};
const anisotropies = (flags.get('anisotropie') ?? '1,16').split(',').map(Number);
assert.ok(
  anisotropies.every((value) => Number.isInteger(value) && value >= 1 && value <= 16),
  '--anisotropie takes integers from 1 to 16',
);
assert.ok(
  existsSync(resolve(ROOT, 'dist/sdk-browser/src/measurement/measurement.js')),
  'dist missing: run `pnpm run build` before this fixture',
);
const { result } = await withRepoPage(
  ROOT,
  flags.get('visible') !== 'true',
  (page): Promise<Awaited<ReturnType<typeof runOnPage>>> =>
    page.evaluate(
      // A template literal: the page module is served at runtime, not resolved by TypeScript.
      (input) => import(`${input.pageUrl}`).then((m) => m.run(input)),
      {
        pageUrl: '/tests/browser/support/anisotropyCostPage.ts',
        sdkUrl: '/dist/sdk-browser/src/measurement/measurement.js',
        anisotropies,
        size: [count('largeur', 1920), count('hauteur', 1080)] as [number, number],
        frames: count('images', 240),
      },
    ),
);
assert.ok(!('unavailable' in result), String((result as { unavailable?: string }).unavailable));
console.log(`GPU: ${result.gpu}; per-pass timestamps: ${result.timed ? 'yes' : 'no'}`);
console.table(
  result.readings.map(({ anisotropy, frameMs, passesMs, samples }) => ({
    anisotropy,
    'image p50 (ms)': frameMs?.toFixed(3) ?? 'unmeasured',
    'passes p50 (ms)': passesMs?.toFixed(3) ?? 'unmeasured',
    samples,
  })),
);
