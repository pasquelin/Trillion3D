// #297: the two published example pages whose cache carries a `clustered-blend` primitive —
// `a-lamp-in-its-glass` (examples/lantern) and `a-lighthouse-beam` (examples/lighthouse), the
// only two of the repository's 50 caches without an `autonomousScene` — still show an image on a
// machine without WebGPU. They take the engine's own `autonomous-pages-webgl` path with
// `autonomous: false`: the same geometry pages, materials and placements read from `source.gltf`.
// Recorded on both machines, same scene, camera, size and commit, with the pixels each drew.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { startServer, serverPort } from '../../scripts/mesure/serveur.ts';
import { launchChrome } from '../../scripts/mesure/chrome.ts';
import { runDefaultBackendCase } from '../appui/defaultBackendCase.ts';
import { BLEND_CACHE_SCENES as SCENES } from '../appui/blendCacheScenes.ts';
import {
  compareDefaultBackendCaptures,
  countDrawnPixels,
  defaultBackendCapturePng,
} from '../appui/defaultBackendImages.ts';

declare global {
  var sdk: typeof import('../../packages/sdk-browser/index.ts');
  var proof: { images: Record<string, number[]> } | undefined;
}

type CaseResult = Awaited<ReturnType<typeof runDefaultBackendCase>>;

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'benchmark-runs/blend-cache-default');
await mkdir(out, { recursive: true });
const chosen = (result: CaseResult) =>
  result.diagnostics.find((event) => event.phase === 'backend-choice')?.context ?? null;

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
  const machine = async (webgpu: boolean, carried: Array<[string, number[]]> = []) => {
    const context = await browser.newContext({
      viewport: { width: 640, height: 480 },
      deviceScaleFactor: 1,
    });
    if (!webgpu)
      // A WebGL2-only machine, simulated where the engine reads the capability: with no
      // `navigator.gpu` no adapter and no device can be obtained.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
      });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${serverPort(server)}`);
    await page.evaluate(async (url) => {
      window.sdk = await import(url);
    }, '/sdk/sdk-browser/index.js');
    // Captures of the other machine, carried in so the two are compared where they both live.
    await page.evaluate((entries: Array<[string, number[]]>) => {
      const store = (window.proof ??= { images: {} });
      for (const [key, bytes] of entries) store.images[key] = bytes;
    }, carried);
    const read: Record<string, { result: CaseResult; drawn: unknown; capture: string }> = {};
    for (const scene of SCENES) {
      const result = (await page.evaluate(runDefaultBackendCase, {
        manifestUrl: `/cache/${scene.page}/full/manifest.json`,
        key: scene.page,
        request: 'default' as const,
        repeats: 0,
        frames: 0,
        lights: scene.lights,
      })) as CaseResult;
      assert.equal(result.error, null, `${scene.page} on ${webgpu ? 'webgpu' : 'webgl2-only'}`);
      const url = await page.evaluate(defaultBackendCapturePng, scene.page);
      const name = `${webgpu ? 'webgpu' : 'webgl2-only'}-${scene.page}.png`;
      await writeFile(resolve(out, name), Buffer.from(url.split(',')[1], 'base64'));
      read[scene.page] = {
        result,
        drawn: await page.evaluate(countDrawnPixels, scene.page),
        capture: name,
      };
    }
    const carry: Array<[string, number[]]> = [],
      against: Record<string, ReturnType<typeof compareDefaultBackendCaptures>> = {};
    for (const scene of SCENES) {
      const key = `webgpu-${scene.page}`;
      carry.push([key, await page.evaluate((one: string) => window.proof!.images[one], scene.page)]);
      if (carried.length)
        against[scene.page] = (await page.evaluate(compareDefaultBackendCaptures, [
          scene.page,
          key,
        ])) as ReturnType<typeof compareDefaultBackendCaptures>;
    }
    await context.close();
    return { read, carry, against };
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
    assert.deepEqual(chosen(webgl.result), {
      kind: 'configuration',
      scope: 'full',
      origin: 'default',
      reason: 'no WebGPU device and no prepared autonomous scene; the same path reads source.gltf',
      renderer: 'autonomous-pages-webgl',
      autonomous: false,
      webgpuDevice: false,
    });
    // The canvas is not empty: a twentieth of it at least differs from the cleared background.
    for (const side of [gpu.drawn, webgl.drawn]) {
      const counted = side as { drawn: number; totalPixels: number };
      assert.ok(counted.drawn > counted.totalPixels / 20, `${scene.page}: ${JSON.stringify(side)}`);
    }
  }
  assert.deepEqual(errors, []);
  const side = (name: string, run: Awaited<ReturnType<typeof machine>>) => [
    name,
    Object.fromEntries(
      SCENES.map((scene) => [
        scene.page,
        {
          backend: run.read[scene.page].result.backend,
          choice: chosen(run.read[scene.page].result),
          mounted: run.read[scene.page].result.mounted,
          metrics: run.read[scene.page].result.metrics,
          drawnPixels: run.read[scene.page].drawn,
          capture: run.read[scene.page].capture,
          // Against the WebGPU capture of the same page: the declared cost of this path, which
          // publishes `shadows: false` and casts none.
          againstWebgpu: run.against[scene.page] ?? null,
        },
      ]),
    ),
  ];
  const result = {
    captureDirectory: relative(root, out),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scenes: SCENES,
    viewport: { width: 480, height: 320, devicePixelRatio: 1 },
    settings: { pixelError: 0, temporalAntialiasing: false, scope: 'full' },
    machines: Object.fromEntries([side('webgpu', withGpu), side('webgl2-only', withoutGpu)]),
  };
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
