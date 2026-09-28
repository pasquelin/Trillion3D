// #875: a paged surface draws its normal map as its unpaged twin does. A geometry page stores no
// tangent: a paged transparent rebuilds its frame from screen derivatives
// (`webgpu/blend/shaderSurface.ts`), a paged opaque one from its triangle's texture coordinates
// (`visibility/shader/shadeWgsl.ts`). The unpaged twin, a `shared-blend` primitive, is drawn forward
// from its source buffers and reads the authored tangents (`webgpu/blend/prepare.ts`). The scenes
// are the public `normal-tangent-mirror-test`, whose tangents are mirrored on half its texture,
// blended and opaque (`bench/runner/scenes/tangentScenes.ts`).
//
// - Blended pair: both twins take the forward blend pass, so the tangent source is the only
//   difference, and the two WebGPU captures must be the same to the pixel.
// - Opaque pair: recorded, not asserted. The resolve reads authored tangents only on a row with no
//   geometry page (`HAS_TANGENT`, `shadeWgsl.ts`), which no current cache has: the compiler writes
//   one for every cluster. The only opaque WebGPU path that reads them is the forward pass of the
//   unpaged twin, another shader than the resolve, so a difference there is not the tangents' alone.
// - WebGL2 draws each unpaged scene beside them, recorded: it rebuilds its frame from screen
//   derivatives too (`webgl/cluster/shaders.ts`), so it is no tangent reference either.
//
//   node bench/runner/scenes/tangentScenes.ts
//   node bench/runner/assets.ts --only normal-tangent-blend-paged,normal-tangent-blend-unpaged,normal-tangent-opaque-paged,normal-tangent-opaque-unpaged
//   node tests/browser/test-gpu.ts tests/browser/renders/page-tangents.browser.ts
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { ASSETS, assetsManifest, sceneDerived } from '../../../bench/runner/scene.ts';
import { readCacheManifest } from '../../../bench/runner/cacheManifest.ts';
import { SUN } from '../../../bench/runner/lamps.ts';
import { TANGENT_SCENES } from '../../../bench/runner/scenes/tangentScenes.ts';
import { measureOutput } from '../../../bench/core/paths.ts';
import { runDefaultBackendCase } from '../support/defaultBackendCase.ts';
import { openMachine, type CaseResult } from '../support/defaultBackendMachine.ts';
import {
  compareDefaultBackendCaptures,
  countDrawnPixels,
  defaultBackendCapturePng,
} from '../support/defaultBackendImages.ts';

type Surface = keyof typeof TANGENT_SCENES;
const SURFACES = Object.keys(TANGENT_SCENES) as Surface[];
const PATHS = ['paged', 'unpaged'] as const;

const root = resolve(import.meta.dirname, '../../..');
const out = measureOutput('page-tangents');
await mkdir(out, { recursive: true });
// Each scene must have been compiled to its pass: a pair of one path compares nothing.
const manifests: Record<string, string> = {};
for (const surface of SURFACES)
  for (const path of PATHS) {
    const { scene, pass } = TANGENT_SCENES[surface][path];
    manifests[`${surface}-${path}`] = assetsManifest(scene, true);
    const { manifest } = await readCacheManifest(join(sceneDerived(scene), 'native/full'));
    assert.deepEqual(
      manifest.primitives.map((primitive) => primitive.pass),
      manifest.primitives.map(() => pass),
      `${scene} compiled to ${pass}`,
    );
  }

/** One capture on `page` of the scene `manifestUrl` names, stored under `key` and written beside
 *  the result; drawn by `backend` when one is named. */
async function capture(page: Page, key: string, manifestUrl: string, backend?: string) {
  const result = (await page.evaluate(runDefaultBackendCase, {
    manifestUrl,
    key,
    request: 'default' as const,
    repeats: 0,
    frames: 0,
    lights: [SUN],
  })) as CaseResult;
  assert.equal(result.error, null, key);
  if (backend) assert.equal(result.backend, backend, key);
  const url = await page.evaluate(defaultBackendCapturePng, key);
  await writeFile(resolve(out, `${key}.png`), Buffer.from(url.split(',')[1], 'base64'));
  const drawn = await page.evaluate(countDrawnPixels, key);
  assert.ok(drawn.drawn > drawn.totalPixels / 20, `${key}: ${JSON.stringify(drawn)}`);
  return { backend: result.backend, metrics: result.metrics };
}

const compare = (page: Page, a: string, b: string) =>
  page.evaluate(compareDefaultBackendCaptures, [a, b] as [string, string]);

const { server, port } = await startServer({
  mounts: [
    { prefix: '/sdk/', dir: resolve(root, 'dist') },
    { prefix: '/benchmark-assets/', dir: ASSETS },
  ],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  const { context, page } = await openMachine({ browser, port, webgpu: true, errors });
  // Interleaved, twice each: the A/A of a scene says what the harness itself moves.
  const captures: Record<string, Awaited<ReturnType<typeof capture>>> = {};
  for (const run of [1, 2])
    for (const scene of Object.keys(manifests))
      captures[`${scene}-${run}`] = await capture(
        page,
        `${scene}-${run}`,
        manifests[scene],
        'webgpu-page-raster',
      );
  const deltas: Record<string, Awaited<ReturnType<typeof compare>>> = {};
  for (const scene of Object.keys(manifests))
    deltas[`${scene} A/A`] = await compare(page, `${scene}-1`, `${scene}-2`);
  for (const surface of SURFACES)
    deltas[`${surface} paged vs unpaged`] = await compare(
      page,
      `${surface}-paged-1`,
      `${surface}-unpaged-1`,
    );
  const carried = await page.evaluate(
    (keys: string[]) => keys.map((key) => window.proof!.images[key]),
    SURFACES.map((surface) => `${surface}-unpaged-1`),
  );
  await context.close();
  // Each unpaged scene on a machine without WebGPU, against the WebGPU capture carried in.
  const webgl = await openMachine({ browser, port, webgpu: false, errors });
  await webgl.page.evaluate(
    ([keys, images]: [string[], number[][]]) => {
      const store = (window.proof ??= { images: {} });
      keys.forEach((key, i) => (store.images[`webgpu-${key}`] = images[i]));
    },
    [SURFACES.map((surface) => `${surface}-unpaged`), carried] as [string[], number[][]],
  );
  const webgl2: Record<string, unknown> = {};
  for (const surface of SURFACES) {
    const key = `${surface}-unpaged`;
    const reference = await capture(webgl.page, `webgl2-${key}`, manifests[key]);
    webgl2[key] = {
      backend: reference.backend,
      againstWebgpu: await compare(webgl.page, `webgl2-${key}`, `webgpu-${key}`),
    };
  }
  await webgl.context.close();
  const result = { scenes: TANGENT_SCENES, captures, deltas, webgl2 };
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  for (const scene of Object.keys(manifests))
    assert.equal(deltas[`${scene} A/A`].differentPixels, 0, `${scene} A/A`);
  const blend = deltas['blend paged vs unpaged'];
  assert.equal(blend.differentPixels, 0, `blend paged vs unpaged: ${JSON.stringify(blend)}`);
} finally {
  await browser.close();
  server.close();
}
