// #875: a paged transparent surface draws its normal map as the unpaged one does. The paged path
// reads no tangent from its geometry pages and rebuilds the frame from screen derivatives
// (`webgpu/blend/shaderSurface.ts`); the unpaged path reads the authored tangents. The public
// `normal-tangent-mirror-test`, blended, carries authored tangents mirrored on half its texture:
// drawn from its pages and from its source buffers on WebGPU, the two captures must be the same
// to the pixel. The WebGL2 capture of the unpaged scene is recorded beside them, not asserted: it
// is another renderer.
//
//   node bench/runner/scenes/tangentBlend.ts
//   node bench/runner/assets.ts --only normal-tangent-blend-paged,normal-tangent-blend-unpaged
//   node tests/browser/test-gpu.ts tests/browser/renders/blend-page-tangents.browser.ts
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { ASSETS, assetsManifest, sceneDerived } from '../../../bench/runner/scene.ts';
import { readCacheManifest } from '../../../bench/runner/cacheManifest.ts';
import { SUN } from '../../../bench/runner/lamps.ts';
import { TANGENT_BLEND_SCENES } from '../../../bench/runner/scenes/tangentBlend.ts';
import { measureOutput } from '../../../bench/core/paths.ts';
import { runDefaultBackendCase } from '../support/defaultBackendCase.ts';
import { openMachine, type CaseResult } from '../support/defaultBackendMachine.ts';
import {
  compareDefaultBackendCaptures,
  countDrawnPixels,
  defaultBackendCapturePng,
} from '../support/defaultBackendImages.ts';

type Side = keyof typeof TANGENT_BLEND_SCENES;

const root = resolve(import.meta.dirname, '../../..');
const out = measureOutput('blend-page-tangents');
await mkdir(out, { recursive: true });
/** The pass each scene must have been compiled to: the proof compares nothing otherwise. */
const PASSES: Record<Side, string> = { paged: 'clustered-blend', unpaged: 'shared-blend' };
const manifests = {} as Record<Side, string>;
for (const side of ['paged', 'unpaged'] as const) {
  const scene = TANGENT_BLEND_SCENES[side];
  manifests[side] = assetsManifest(scene, true);
  const { manifest } = await readCacheManifest(join(sceneDerived(scene), 'native/full'));
  assert.deepEqual(
    manifest.primitives.map((primitive) => primitive.pass),
    manifest.primitives.map(() => PASSES[side]),
    `${scene} compiled to ${PASSES[side]}`,
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
  // Interleaved, twice each: the A/A of a side says what the harness itself moves.
  const captures: Record<string, Awaited<ReturnType<typeof capture>>> = {};
  for (const run of [1, 2])
    for (const side of ['paged', 'unpaged'] as const)
      captures[`${side}-${run}`] = await capture(
        page,
        `${side}-${run}`,
        manifests[side],
        'webgpu-page-raster',
      );
  const deltas = {
    pagedAA: await compare(page, 'paged-1', 'paged-2'),
    unpagedAA: await compare(page, 'unpaged-1', 'unpaged-2'),
    pagedVsUnpaged: await compare(page, 'paged-1', 'unpaged-1'),
  };
  const carried = await page.evaluate(() => window.proof!.images['unpaged-1']);
  await context.close();
  // The unpaged scene on a machine without WebGPU, against the WebGPU capture carried in.
  const webgl = await openMachine({ browser, port, webgpu: false, errors });
  await webgl.page.evaluate((bytes: number[]) => {
    (window.proof ??= { images: {} }).images['webgpu-unpaged'] = bytes;
  }, carried);
  const reference = await capture(webgl.page, 'webgl2-unpaged', manifests.unpaged);
  const webglAgainstWebgpu = await compare(webgl.page, 'webgl2-unpaged', 'webgpu-unpaged');
  await webgl.context.close();
  const result = {
    scenes: TANGENT_BLEND_SCENES,
    captures,
    deltas,
    webgl2: { backend: reference.backend, againstWebgpuUnpaged: webglAgainstWebgpu },
  };
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(deltas.pagedAA.differentPixels, 0, 'paged A/A');
  assert.equal(deltas.unpagedAA.differentPixels, 0, 'unpaged A/A');
  assert.equal(
    deltas.pagedVsUnpaged.differentPixels,
    0,
    `paged against unpaged: ${JSON.stringify(deltas.pagedVsUnpaged)}`,
  );
} finally {
  await browser.close();
  server.close();
}
