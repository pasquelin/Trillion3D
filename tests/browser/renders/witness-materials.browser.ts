// Proof by the real render: what a material is worth on screen, engine against witness. Every
// fixture of `tests/browser/support/materialFixtures.ts` is drawn by `three-webgl-reference` and by
// `webgpu-page-raster`, both from `dist/`, and read pixel by pixel at the points that exercise
// its feature — base colour, its map, alpha MASK at its cutoff, BLEND, emissive, metal-roughness,
// normal map, double-sided. A gap outside the fixture's declared window, a missing render
// diagnostic, a GPU failure or an engine image that never holds turns the run red.
//
// The harness server of `bench/runner` serves the page and its import map, the SDK, the page
// modules of `tests/` and the engine sources they import; nothing outside this repository is
// read. Per-fixture readings and both images land under `.mesure/out/material-pixels/<run>/`.
//
//   node tests/browser/renders/witness-materials.browser.ts [run-name]
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withRepoPage } from '../../kit/server/repoPage.ts';
import { ANISOTROPY_GAIN, fixtures } from '../support/materialFixtures.ts';
import type { run as runOnPage } from '../support/materialPixelsPage.ts';
import { measureOutput } from '../../../bench/core/paths.ts';

type RunResult = Awaited<ReturnType<typeof runOnPage>>;

const ROOT = resolve(import.meta.dirname, '../../..');
const run = process.argv[2] ?? new Date().toISOString().replaceAll(':', '-');
const out = measureOutput('material-pixels', run);
assert.ok(
  existsSync(resolve(ROOT, 'dist/sdk-browser/src/measurement/measurement.js')),
  'dist missing: run `pnpm run build` before this proof',
);
const result: RunResult = await withRepoPage(ROOT, true, (page) =>
  page.evaluate(
    // A template literal, not a static specifier: TypeScript cannot resolve this page module
    // (served only at runtime by the harness) as a real import, so it stays untyped `any`
    // rather than a "cannot find module" error.
    (urls) => import(`${urls.pageUrl}`).then((m) => m.run(urls)),
    {
      sdkUrl: '/dist/sdk-browser/src/measurement/measurement.js',
      coreUrl: '/dist/sdk-core/src/index.js',
      pageUrl: '/tests/browser/support/materialPixelsPage.ts',
    },
  ),
);

await mkdir(out, { recursive: true });
for (const fixture of result.results ?? [])
  for (const [side, dataUrl] of Object.entries(fixture.images)) {
    const file = `${fixture.name.replaceAll(' ', '-')}-${side}.png`;
    await writeFile(resolve(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    delete (fixture.images as Record<string, string>)[side];
  }
await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    (result.results ?? []).map(({ name, difference, samples }) => ({
      name,
      difference,
      gap: Math.max(...samples.map((s) => s.gap)),
    })),
    null,
    2,
  ),
);

assert.equal(result.unavailable ?? null, null, String(result.unavailable));
assert.equal(result.error ?? null, null, String(result.error));
assert.deepEqual(result.errors, [], 'GPU uncaptured errors');
assert.ok(result.results, 'no fixture results');
assert.equal(result.results.length, fixtures.length, 'one reading per fixture');
for (const fixture of result.results) {
  const phases = fixture.events.map((event) => event.phase);
  for (const phase of ['material-textures', 'render-capabilities', 'first-readback'])
    assert.ok(phases.includes(phase), `${fixture.name}: missing render diagnostic ${phase}`);
  assert.ok(
    !phases.some((phase) => /failed|gpu-device-lost/.test(phase)),
    `${fixture.name}: GPU failure diagnostic — inspect ${out}/result.json`,
  );
  assert.ok(
    fixture.events.some(
      (event) => event.phase === 'render-capabilities' && event.context.visibilityBuffer,
    ),
    `${fixture.name}: real visibility buffer required`,
  );
  if (fixture.holds !== false)
    assert.equal(fixture.held, true, `${fixture.name}: the engine image never settled`);
  if (fixture.holes !== undefined)
    assert.equal(fixture.holes, 0, `${fixture.name}: ${fixture.holes} pixels show the background`);
  const [least, most] = fixture.difference;
  for (const { point, witness, engine, gap } of fixture.samples)
    assert.ok(
      gap >= least && gap <= most,
      `${fixture.name} (${point}): witness ${witness}, engine ${engine}, ` +
        `gap ${gap} outside ${least}–${most} (${fixture.reason})`,
    );
}
// #361: anisotropy 16 against 1 on the grazing stripes: each engine must gain contrast.
const spread = (name: string, side: 'witness' | 'engine') => {
  const means = result
    .results!.find((fixture) => fixture.name === name)!
    .samples.map((sample) => sample[side].reduce((sum, c) => sum + c, 0) / sample[side].length);
  return Math.max(...means) - Math.min(...means);
};
for (const side of ['witness', 'engine'] as const) {
  const flat = spread('grazing stripes, anisotropy 1', side),
    sharp = spread('grazing stripes, anisotropy 16', side);
  assert.ok(
    sharp - flat >= ANISOTROPY_GAIN,
    `${side}: anisotropy 16 spreads ${sharp} levels, anisotropy 1 ${flat}; ` +
      `at least ${ANISOTROPY_GAIN} more expected`,
  );
}
console.log(
  `OK: ${result.results.length} material fixtures agree with the witness — ${result.gpu}`,
);
