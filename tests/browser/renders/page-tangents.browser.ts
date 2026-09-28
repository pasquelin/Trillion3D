// #875: a paged surface draws its normal map as its unpaged twin does. A geometry page stores no
// tangent: a paged transparent rebuilds its frame from screen derivatives
// (`webgpu/blend/shaderSurface.ts`), a paged opaque one from its triangle's texture coordinates
// (`visibility/shader/shadeWgsl.ts`). The unpaged twin, a `shared-blend` primitive, is drawn forward
// from its source buffers and reads the authored tangents (`webgpu/blend/prepare.ts`). The scenes
// are the public `normal-tangent-mirror-test`, whose tangents are mirrored on half its texture,
// blended and opaque (`bench/runner/scenes/tangentScenes.ts`, which prints how to compile them).
//
// - Blended pair: both twins take the forward blend pass, so the tangent source is the only
//   difference, and the two WebGPU captures must be the same to the pixel.
// - Opaque pair: recorded, not asserted. The resolve reads authored tangents only on a row with no
//   geometry page (`HAS_TANGENT`, `shadeWgsl.ts`), which no current cache has: the compiler writes
//   one for every cluster. The only opaque WebGPU path that reads them is the forward pass of the
//   unpaged twin, another shader than the resolve, so a difference there is not the tangents' alone.
// - No WebGL2 capture: that path rebuilds its frame from screen derivatives too
//   (`webgl/cluster/shaders.ts`), so it is no tangent reference.
//
//   node tests/browser/test-gpu.ts tests/browser/renders/page-tangents.browser.ts
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { ASSETS, assetsManifest, sceneDerived } from '../../../bench/runner/scene.ts';
import { readCacheManifest } from '../../../bench/runner/cacheManifest.ts';
import { SUN } from '../../../bench/runner/lamps.ts';
import { TANGENT_SCENES } from '../../../bench/runner/scenes/tangentScenes.ts';
import { measureOutput } from '../../../bench/core/paths.ts';
import { sdkMounts } from '../support/renderHarness.ts';
import { runDefaultBackendCase } from '../support/defaultBackendCase.ts';
import { openMachine, type CaseResult } from '../support/defaultBackendMachine.ts';
import {
  compareDefaultBackendCaptures,
  countDrawnPixels,
  defaultBackendCapturePng,
} from '../support/defaultBackendImages.ts';

const SURFACES = [...new Set(TANGENT_SCENES.map(({ surface }) => surface))];

const root = resolve(import.meta.dirname, '../../..');
const out = measureOutput('page-tangents');
await mkdir(out, { recursive: true });
// Each scene must have been compiled to its pass: a pair of one path compares nothing.
for (const { scene, pass } of TANGENT_SCENES) {
  const { manifest } = await readCacheManifest(join(sceneDerived(scene), 'native/full'));
  assert.ok(manifest.primitives.length > 0, `${scene} compiled no primitive`);
  assert.deepEqual(
    manifest.primitives.map((primitive) => primitive.pass),
    manifest.primitives.map(() => pass),
    `${scene} compiled to ${pass}`,
  );
}

const { server, port } = await startServer({
  mounts: [...sdkMounts(root), { prefix: '/benchmark-assets/', dir: ASSETS }],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  const { context, page } = await openMachine({ browser, port, webgpu: true, errors });
  /** One WebGPU capture of `scene`, stored under `key` and written beside the result. */
  const capture = async (key: string, scene: string) => {
    const result = (await page.evaluate(runDefaultBackendCase, {
      manifestUrl: assetsManifest(scene, true),
      key,
      request: 'default' as const,
      repeats: 0,
      frames: 0,
      lights: [SUN],
    })) as CaseResult;
    assert.equal(result.error, null, key);
    assert.equal(result.backend, 'webgpu-page-raster', key);
    const url = await page.evaluate(defaultBackendCapturePng, key);
    await writeFile(resolve(out, `${key}.png`), Buffer.from(url.split(',')[1], 'base64'));
    const drawn = await page.evaluate(countDrawnPixels, key);
    assert.ok(drawn.drawn > drawn.totalPixels / 20, `${key}: ${JSON.stringify(drawn)}`);
    return result.metrics;
  };
  // A tuple, as `compareDefaultBackendCaptures` takes it: a bare `[a, b]` widens to `string[]`.
  const compare = (a: string, b: string) => {
    const pair: [string, string] = [a, b];
    return page.evaluate(compareDefaultBackendCaptures, pair);
  };
  // Interleaved, twice each: the A/A of a scene says what the harness itself moves.
  const captures: Record<string, unknown> = {};
  for (const run of [1, 2])
    for (const { key, scene } of TANGENT_SCENES)
      captures[`${key}-${run}`] = await capture(`${key}-${run}`, scene);
  const deltas: Record<string, Awaited<ReturnType<typeof compare>>> = {};
  for (const { key } of TANGENT_SCENES)
    deltas[`${key} A/A`] = await compare(`${key}-1`, `${key}-2`);
  for (const surface of SURFACES)
    deltas[`${surface} paged vs unpaged`] = await compare(
      `${surface}-paged-1`,
      `${surface}-unpaged-1`,
    );
  await context.close();
  const result = { scenes: TANGENT_SCENES, captures, deltas };
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  for (const { key } of TANGENT_SCENES)
    assert.equal(deltas[`${key} A/A`].differentPixels, 0, `${key} A/A`);
  const blend = deltas['blend paged vs unpaged'];
  assert.equal(blend.differentPixels, 0, `blend paged vs unpaged: ${JSON.stringify(blend)}`);
} finally {
  await browser.close();
  server.close();
}
