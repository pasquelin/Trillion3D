// Proof by the real render: what a material is worth on screen, engine against witness. Every
// fixture of `test/appui/materialFixtures.mjs` is drawn by `three-webgl-reference` and by
// `webgpu-page-raster`, both from `dist/`, and read pixel by pixel at the points that exercise
// its feature — base colour, its map, alpha MASK at its cutoff, BLEND, emissive, metal-roughness,
// normal map, double-sided. A difference above the fixture's declared tolerance, a missing render
// diagnostic or a GPU failure turns the run red.
//
// The harness server of `scripts/mesure` serves the page and its import map, the SDK and the
// page modules of `test/`; nothing outside this repository is read. Per-fixture readings and both
// images land under `benchmark-runs/material-pixels/<run>/`.
//
//   node test/browser/materiaux-temoin.browser.mjs [run-name]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome } from '../../scripts/mesure/chrome.mjs';
import { resolveMounts } from '../../scripts/mesure/options.mjs';
import { startServer } from '../../scripts/mesure/serveur.mjs';
import { fixtures } from '../appui/materialFixtures.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const run = process.argv[2] ?? new Date().toISOString().replaceAll(':', '-');
const out = resolve(ROOT, 'benchmark-runs/material-pixels', run);
const mounts = [
  ...resolveMounts(ROOT, []),
  { prefix: '/dist/', dir: resolve(ROOT, 'dist') },
  { prefix: '/test/', dir: resolve(ROOT, 'test') },
];
const server = await startServer({ port: 0, mounts, captures: new Map() });
const browser = await launchChrome({ headless: true });
let result;
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  result = await page.evaluate(
    (urls) => import('/test/appui/materialPixelsPage.mjs').then((m) => m.run(urls)),
    { sdkUrl: '/dist/sdk-browser/index.js', coreUrl: '/dist/sdk-core/index.js' },
  );
  result.pageErrors = pageErrors;
} finally {
  await browser.close();
  server.close();
}

await mkdir(out, { recursive: true });
for (const fixture of result.results ?? [])
  for (const [side, dataUrl] of Object.entries(fixture.images)) {
    const file = `${fixture.name.replaceAll(' ', '-')}-${side}.png`;
    await writeFile(resolve(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    delete fixture.images[side];
  }
await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    (result.results ?? []).map(({ name, tolerance, samples }) => ({
      name,
      tolerance,
      maxDifference: Math.max(
        ...samples.map((s) => Math.max(...s.witness.map((c, i) => Math.abs(c - s.engine[i])))),
      ),
    })),
    null,
    2,
  ),
);

assert.equal(result.unavailable ?? null, null, String(result.unavailable));
assert.equal(result.error ?? null, null, String(result.error));
assert.deepEqual(result.pageErrors, []);
assert.deepEqual(result.errors, [], 'GPU uncaptured errors');
assert.equal(result.results.length, fixtures.length, 'one reading per fixture');
for (const fixture of result.results) {
  const phases = fixture.events.map((event) => event.phase);
  for (const phase of ['material-textures', 'render-capabilities', 'first-readback'])
    assert.ok(phases.includes(phase), `${fixture.name}: missing render diagnostic ${phase}`);
  assert.ok(
    !phases.some((phase) => /failed|uncaptured-error/.test(phase)),
    `${fixture.name}: GPU failure diagnostic — inspect ${out}/result.json`,
  );
  assert.ok(
    fixture.events.some(
      (event) => event.phase === 'render-capabilities' && event.context.visibilityBuffer,
    ),
    `${fixture.name}: real visibility buffer required`,
  );
  const expected = fixtures.find((f) => f.name === fixture.name);
  assert.ok(expected, `${fixture.name}: not a declared fixture`);
  if (expected.holds !== false)
    assert.equal(fixture.held, true, `${fixture.name}: the engine image never settled`);
  for (const { point, witness, engine } of fixture.samples) {
    const difference = Math.max(...witness.map((c, i) => Math.abs(c - engine[i])));
    assert.ok(
      difference <= fixture.tolerance,
      `${fixture.name} (${point}): witness ${witness}, engine ${engine}, ` +
        `difference ${difference} above ${fixture.tolerance} (${fixture.reason})`,
    );
  }
}
console.log(
  `OK: ${result.results.length} material fixtures agree with the witness — ${result.gpu}`,
);
