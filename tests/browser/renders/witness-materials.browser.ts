// Proof by the real render: what a material is worth on screen, engine against witness. Every
// fixture of `tests/browser/support/materialFixtures.ts` is drawn by `three-webgl-reference` and by
// `webgpu-page-raster`, both from `dist/`, and read pixel by pixel at the points that exercise
// its feature — base colour, its map, alpha MASK at its cutoff, BLEND, emissive, metal-roughness,
// normal map, double-sided. A gap outside the fixture's declared window, a missing render
// diagnostic, a GPU failure or an engine image that never holds turns the run red.
//
// The harness server of `bench/runner` serves the page and its import map, the SDK, the page
// modules of `tests/` and the engine sources they import; nothing outside this repository is
// read. Per-fixture readings and both images land under `benchmark-runs/material-pixels/<run>/`.
//
//   node tests/browser/renders/witness-materials.browser.ts [run-name]
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { startServer, serverPort } from '../../kit/server/staticServer.ts';
import { fixtures } from '../support/materialFixtures.ts';
import type { run as runOnPage } from '../support/materialPixelsPage.ts';

type RunResult = Awaited<ReturnType<typeof runOnPage>> & { pageErrors?: string[] };

const ROOT = resolve(import.meta.dirname, '../../..');
const run = process.argv[2] ?? new Date().toISOString().replaceAll(':', '-');
const out = resolve(ROOT, 'benchmark-runs/material-pixels', run);
assert.ok(
  existsSync(resolve(ROOT, 'dist/witnesses/measurement.js')),
  'dist missing: run `pnpm run build` before this proof',
);
const mounts = [
  ...resolveMounts(ROOT, []),
  { prefix: '/dist/', dir: resolve(ROOT, 'dist') },
  { prefix: '/tests/', dir: resolve(ROOT, 'tests') },
  // The page modules under `tests/` import engine sources by relative path (`DAG`, `asHostLibrary`).
  { prefix: '/packages/', dir: resolve(ROOT, 'packages') },
];
const server = await startServer({ port: 0, mounts, captures: new Map() });
const browser = await launchChrome({ headless: true });
let result: RunResult;
try {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  result = await page.evaluate(
    // A template literal, not a static specifier: TypeScript cannot resolve this page module
    // (served only at runtime by the harness) as a real import, so it stays untyped `any`
    // rather than a "cannot find module" error.
    (urls) => import(`${urls.pageUrl}`).then((m) => m.run(urls)),
    {
      sdkUrl: '/dist/witnesses/measurement.js',
      coreUrl: '/dist/sdk-core/src/index.js',
      pageUrl: '/tests/browser/support/materialPixelsPage.ts',
    },
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
assert.deepEqual(result.pageErrors, []);
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
  const [least, most] = fixture.difference;
  for (const { point, witness, engine, gap } of fixture.samples)
    assert.ok(
      gap >= least && gap <= most,
      `${fixture.name} (${point}): witness ${witness}, engine ${engine}, ` +
        `gap ${gap} outside ${least}–${most} (${fixture.reason})`,
    );
}
console.log(
  `OK: ${result.results.length} material fixtures agree with the witness — ${result.gpu}`,
);
