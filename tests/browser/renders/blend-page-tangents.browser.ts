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
import { resolve } from 'node:path';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { ASSETS, assetsManifest } from '../../../bench/runner/scene.ts';
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

const root = resolve(import.meta.dirname, '../../..');
const out = measureOutput('blend-page-tangents');
await mkdir(out, { recursive: true });
const manifests = {
  paged: assetsManifest(TANGENT_BLEND_SCENES.paged, true),
  unpaged: assetsManifest(TANGENT_BLEND_SCENES.unpaged, true),
};

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
  /** One capture of the scene `manifestUrl` names, stored under `key` and written beside the result. */
  const capture = async (key: string, manifestUrl: string) => {
    const result = (await page.evaluate(runDefaultBackendCase, {
      manifestUrl,
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
  const compare = (a: string, b: string) =>
    page.evaluate(compareDefaultBackendCaptures, [a, b] as [string, string]);
  // Interleaved, twice each: the A/A of a side says what the harness itself moves.
  const metrics = {
    'paged-1': await capture('paged-1', manifests.paged),
    'unpaged-1': await capture('unpaged-1', manifests.unpaged),
    'paged-2': await capture('paged-2', manifests.paged),
    'unpaged-2': await capture('unpaged-2', manifests.unpaged),
  };
  const deltas = {
    pagedAA: await compare('paged-1', 'paged-2'),
    unpagedAA: await compare('unpaged-1', 'unpaged-2'),
    pagedVsUnpaged: await compare('paged-1', 'unpaged-1'),
  };
  const carried = await page.evaluate(() => window.proof!.images['unpaged-1']);
  await context.close();
  // The unpaged scene on a machine without WebGPU, against the WebGPU capture carried in.
  const webgl = await openMachine({ browser, port, webgpu: false, errors });
  await webgl.page.evaluate((bytes: number[]) => {
    (window.proof ??= { images: {} }).images['webgpu-unpaged'] = bytes;
  }, carried);
  const reference = (await webgl.page.evaluate(runDefaultBackendCase, {
    manifestUrl: manifests.unpaged,
    key: 'webgl2-unpaged',
    request: 'default' as const,
    repeats: 0,
    frames: 0,
    lights: [SUN],
  })) as CaseResult;
  assert.equal(reference.error, null, 'webgl2-unpaged');
  const png = await webgl.page.evaluate(defaultBackendCapturePng, 'webgl2-unpaged');
  await writeFile(resolve(out, 'webgl2-unpaged.png'), Buffer.from(png.split(',')[1], 'base64'));
  const webglAgainstWebgpu = await webgl.page.evaluate(compareDefaultBackendCaptures, [
    'webgl2-unpaged',
    'webgpu-unpaged',
  ] as [string, string]);
  await webgl.context.close();
  const result = {
    scenes: TANGENT_BLEND_SCENES,
    capture: { width: 480, height: 320, devicePixelRatio: 1 },
    metrics,
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
