// #297: the two published example pages whose cache carries a `clustered-blend` primitive —
// `a-lamp-in-its-glass` (examples/lantern) and `a-lighthouse-beam` (examples/lighthouse), the
// only two of the repository's 50 caches without an `autonomousScene` — still show an image on a
// machine without WebGPU. They take the engine's own `autonomous-pages-webgl` path with
// `autonomous: false`: the same geometry pages, with materials and placements from `source.gltf`.
// Recorded on both machines, same scene, camera, size and commit, with the pixels each drew and
// what the WebGL2 image costs against the WebGPU one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { startServer } from '../../scripts/mesure/serveur.ts';
import { launchChrome } from '../../scripts/mesure/chrome.ts';
import { runDefaultBackendCase } from '../appui/defaultBackendCase.ts';
import { BLEND_CACHE_SCENES as SCENES } from '../appui/blendCacheScenes.ts';
import {
  chosenBackend,
  machineLabel,
  openMachine,
  type CaseResult,
} from '../appui/defaultBackendMachine.ts';
import {
  compareDefaultBackendCaptures,
  countDrawnPixels,
  defaultBackendCapturePng,
} from '../appui/defaultBackendImages.ts';

type Delta = ReturnType<typeof compareDefaultBackendCaptures>;
type Read = { result: CaseResult; drawn: ReturnType<typeof countDrawnPixels>; capture: string };

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'benchmark-runs/blend-cache-default');
await mkdir(out, { recursive: true });
/** The capture of a page on the WebGPU machine, carried into the other one to be compared. */
const carriedKey = (page: string) => `webgpu-${page}`;

const server = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [
    { prefix: '/sdk/', dir: resolve(root, 'dist') },
    { prefix: '/vendor/three/', dir: resolve(root, 'node_modules/three') },
    // Each cache keeps its own `native/full` + `native/objects` pair: a page's stream URLs are
    // relative to its manifest and climb back to the shared object folder of its own asset.
    ...SCENES.flatMap((scene) =>
      ['full', 'objects'].map((part) => ({
        prefix: `/cache/${scene.page}/${part}/`,
        dir: resolve(root, `site/assets/${scene.asset}/cache/native/${part}`),
      })),
    ),
  ],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  // The lights below are a copy of what each page declares; the copy is worthless if it drifts.
  for (const scene of SCENES) {
    const source = await readFile(resolve(root, `site/examples/${scene.page}.html`), 'utf8');
    for (const light of scene.lights)
      assert.ok(
        source.includes(`id: '${light.id}'`) && source.includes(`intensity: ${light.intensity}`),
        `${scene.page}.html no longer declares ${light.id} at intensity ${light.intensity}`,
      );
  }
  const machine = async (webgpu: boolean, carried: Array<[string, number[]]> = []) => {
    const label = machineLabel(webgpu);
    const { context, page } = await openMachine({ browser, server, webgpu, errors });
    // Captures of the other machine, carried in so the two are compared where they both live.
    await page.evaluate((entries: Array<[string, number[]]>) => {
      const store = (window.proof ??= { images: {} });
      for (const [key, bytes] of entries) store.images[key] = bytes;
    }, carried);
    const read: Record<string, Read> = {};
    for (const scene of SCENES) {
      const result = (await page.evaluate(runDefaultBackendCase, {
        manifestUrl: `/cache/${scene.page}/full/manifest.json`,
        key: scene.page,
        request: 'default' as const,
        repeats: 0,
        frames: 0,
        lights: scene.lights,
      })) as CaseResult;
      assert.equal(result.error, null, `${scene.page} on ${label}`);
      const url = await page.evaluate(defaultBackendCapturePng, scene.page);
      const capture = `${label}-${scene.page}.png`;
      await writeFile(resolve(out, capture), Buffer.from(url.split(',')[1], 'base64'));
      const drawn = (await page.evaluate(countDrawnPixels, scene.page)) as Read['drawn'];
      read[scene.page] = { result, drawn, capture };
    }
    // The first machine hands its pixels to the second; the second is the one that compares.
    const carry: Array<[string, number[]]> = [];
    const against: Record<string, Delta> = {};
    for (const scene of SCENES)
      if (carried.length)
        against[scene.page] = (await page.evaluate(compareDefaultBackendCaptures, [
          scene.page,
          carriedKey(scene.page),
        ] as [string, string])) as Delta;
      else
        carry.push([
          carriedKey(scene.page),
          await page.evaluate((one: string) => window.proof!.images[one], scene.page),
        ]);
    await context.close();
    return { label, read, carry, against };
  };
  const withGpu = await machine(true);
  const withoutGpu = await machine(false, withGpu.carry);
  for (const scene of SCENES) {
    const gpu = withGpu.read[scene.page],
      webgl = withoutGpu.read[scene.page];
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
      assert.ok(drawn.drawn > drawn.totalPixels / 20, `${scene.page}: ${JSON.stringify(drawn)}`);
  }
  assert.deepEqual(errors, []);
  const side = (run: Awaited<ReturnType<typeof machine>>) =>
    Object.fromEntries(
      SCENES.map((scene) => {
        const one = run.read[scene.page];
        return [
          scene.page,
          {
            backend: one.result.backend,
            choice: chosenBackend(one.result),
            mounted: one.result.mounted,
            metrics: one.result.metrics,
            drawnPixels: one.drawn,
            capture: one.capture,
            // Against the WebGPU capture of the same page: the declared cost of a path that
            // publishes `shadows: false` and casts none.
            againstWebgpu: run.against[scene.page] ?? null,
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
