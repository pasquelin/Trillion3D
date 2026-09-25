// #297: a cache that carries a `clustered-blend` primitive, and so no `autonomousScene` — the
// public `alpha-blend-mode-test` — still shows an image on a machine without WebGPU. It takes the
// engine's own `autonomous-pages-webgl` path with `autonomous: false`: the same geometry pages,
// with materials and placements from `source.gltf`.
// Recorded on both machines, same scene, camera, size and commit, with the pixels each drew and
// what the WebGL2 image costs against the WebGPU one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { runDefaultBackendCase } from '../support/defaultBackendCase.ts';
import { BLEND_CACHE_SCENES as SCENES } from '../support/blendCacheScenes.ts';
import { ASSETS, assetsManifest } from '../../../bench/runner/scene.ts';
import {
  chosenBackend,
  machineLabel,
  openMachine,
  type CaseResult,
} from '../support/defaultBackendMachine.ts';
import {
  compareDefaultBackendCaptures,
  countDrawnPixels,
  defaultBackendCapturePng,
} from '../support/defaultBackendImages.ts';
import { measureOutput } from '../../../bench/core/paths.ts';

type Delta = ReturnType<typeof compareDefaultBackendCaptures>;
type Read = { result: CaseResult; drawn: ReturnType<typeof countDrawnPixels>; capture: string };

const root = resolve(import.meta.dirname, '../../..');
const out = measureOutput('blend-cache-default');
await mkdir(out, { recursive: true });
/** The capture of a scene on the WebGPU machine, carried into the other one to be compared. */
const carriedKey = (name: string) => `webgpu-${name}`;

const { server, port } = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [
    { prefix: '/sdk/', dir: resolve(root, 'dist') },
    { prefix: '/vendor/three/', dir: resolve(root, 'node_modules/three') },
    // The cache, and the images its `source.gltf` names by their `/benchmark-assets/` URL.
    { prefix: '/benchmark-assets/', dir: ASSETS },
  ],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  const machine = async (webgpu: boolean, carried: Array<[string, number[]]> = []) => {
    const label = machineLabel(webgpu);
    const { context, page } = await openMachine({ browser, port, webgpu, errors });
    // Captures of the other machine, carried in so the two are compared where they both live.
    await page.evaluate((entries: Array<[string, number[]]>) => {
      const store = (window.proof ??= { images: {} });
      for (const [key, bytes] of entries) store.images[key] = bytes;
    }, carried);
    const read: Record<string, Read> = {};
    for (const scene of SCENES) {
      const result = (await page.evaluate(runDefaultBackendCase, {
        manifestUrl: assetsManifest(scene.name, true),
        key: scene.name,
        request: 'default' as const,
        repeats: 0,
        frames: 0,
        lights: scene.lights,
      })) as CaseResult;
      assert.equal(result.error, null, `${scene.name} on ${label}`);
      const url = await page.evaluate(defaultBackendCapturePng, scene.name);
      const capture = `${label}-${scene.name}.png`;
      await writeFile(resolve(out, capture), Buffer.from(url.split(',')[1], 'base64'));
      const drawn = (await page.evaluate(countDrawnPixels, scene.name)) as Read['drawn'];
      read[scene.name] = { result, drawn, capture };
    }
    // The first machine hands its pixels to the second; the second is the one that compares.
    const carry: Array<[string, number[]]> = [];
    const against: Record<string, Delta> = {};
    for (const scene of SCENES)
      if (carried.length)
        against[scene.name] = (await page.evaluate(compareDefaultBackendCaptures, [
          scene.name,
          carriedKey(scene.name),
        ] as [string, string])) as Delta;
      else
        carry.push([
          carriedKey(scene.name),
          await page.evaluate((one: string) => window.proof!.images[one], scene.name),
        ]);
    await context.close();
    return { label, read, carry, against };
  };
  const withGpu = await machine(true);
  const withoutGpu = await machine(false, withGpu.carry);
  for (const scene of SCENES) {
    const gpu = withGpu.read[scene.name],
      webgl = withoutGpu.read[scene.name];
    assert.equal(gpu.result.backend, 'webgpu-page-raster');
    // The engine's own path, alone, and reading `source.gltf`: no witness, no black page.
    assert.equal(webgl.result.backend, 'autonomous-pages-webgl');
    assert.deepEqual(webgl.result.mounted, ['autonomous-pages-webgl']);
    assert.deepEqual(chosenBackend(webgl.result), {
      kind: 'configuration',
      scope: 'full',
      origin: 'default',
      reason: 'no WebGPU device and no prepared autonomous scene; the same path reads source.gltf',
      renderer: 'autonomous-pages-webgl',
      autonomous: false,
      webgpuDevice: false,
      // This path samples the host images, so the loader opens them (#289).
      textureSource: 'host',
    });
    // The canvas is not empty: a twentieth of it at least differs from the cleared background.
    for (const drawn of [gpu.drawn, webgl.drawn])
      assert.ok(drawn.drawn > drawn.totalPixels / 20, `${scene.name}: ${JSON.stringify(drawn)}`);
  }
  assert.deepEqual(errors, []);
  const side = (run: Awaited<ReturnType<typeof machine>>) =>
    Object.fromEntries(
      SCENES.map((scene) => {
        const one = run.read[scene.name];
        return [
          scene.name,
          {
            backend: one.result.backend,
            choice: chosenBackend(one.result),
            mounted: one.result.mounted,
            metrics: one.result.metrics,
            drawnPixels: one.drawn,
            capture: one.capture,
            // Against the WebGPU capture of the same page: the declared cost of a path that
            // publishes `shadows: false` and casts none.
            againstWebgpu: run.against[scene.name] ?? null,
          },
        ];
      }),
    );
  const result = {
    captureDirectory: relative(root, out),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scenes: SCENES,
    capture: { width: 480, height: 320, devicePixelRatio: 1 },
    settings: { pixelError: 0, temporalAntialiasing: false, scope: 'full' },
    machines: { [withGpu.label]: side(withGpu), [withoutGpu.label]: side(withoutGpu) },
  };
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
