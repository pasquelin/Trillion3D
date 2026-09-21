// Standalone proof of #274: with no `backends` option the active backend is the engine's own
// path — the WebGPU page raster where a device exists, the autonomous WebGL2 path where none
// does — and never a Three witness. On the WebGPU machine it also records, on the same scene,
// camera, size and commit, the image and the rAF cadence of the new default against the old.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, serverPort } from '../../scripts/mesure/serveur.ts';
import { launchChrome } from '../../scripts/mesure/chrome.ts';
import {
  compareDefaultBackendCaptures,
  defaultBackendCapturePng,
  runDefaultBackendCase,
  type DefaultBackendCase,
} from '../appui/defaultBackendCase.ts';

declare global {
  var sdk: typeof import('../../packages/sdk-browser/index.ts');
  var proof: { images: Record<string, number[]> } | undefined;
}

type CaseResult = Awaited<ReturnType<typeof runDefaultBackendCase>>;
type ImageDelta = ReturnType<typeof compareDefaultBackendCaptures> | null;
type MachineResult = { cases: Record<string, CaseResult>; image: ImageDelta };

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'benchmark-runs/default-backend');
await mkdir(out, { recursive: true });
const SCENE = 'site/assets/kinetic-garden';
const MANIFEST = '/cache/scene/manifest.json';
const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
/** Median rAF interval per repeat, then the spread those repeat medians span. */
function cadence(result: CaseResult) {
  const medians = result.runs.map((run) => quantile(run, 0.5));
  const all = result.runs.flat();
  if (!all.length) return null;
  return {
    frames: all.length,
    medianMs: Number(quantile(all, 0.5).toFixed(3)),
    p05Ms: Number(quantile(all, 0.05).toFixed(3)),
    p95Ms: Number(quantile(all, 0.95).toFixed(3)),
    repeatMediansMs: medians.map((value) => Number(value.toFixed(3))),
    repeatSpreadMs: Number((Math.max(...medians) - Math.min(...medians)).toFixed(3)),
    fpsFromMedian: Number((1000 / quantile(all, 0.5)).toFixed(1)),
  };
}
const chosen = (result: CaseResult) =>
  result.diagnostics.find((event) => event.phase === 'backend-choice')?.context ?? null;

const server = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [
    { prefix: '/sdk/', dir: resolve(root, 'dist') },
    { prefix: '/vendor/three/', dir: resolve(root, 'node_modules/three') },
    { prefix: '/cache/scene/', dir: resolve(root, `${SCENE}/cache/native/full`) },
    { prefix: '/cache/objects/', dir: resolve(root, `${SCENE}/cache/native/objects`) },
  ],
});
const browser = await launchChrome({ headless: true });
const errors: string[] = [];
try {
  const machine = async (webgpu: boolean, requests: DefaultBackendCase['request'][]) => {
    const context = await browser.newContext({
      viewport: { width: 640, height: 480 },
      deviceScaleFactor: 1,
    });
    if (!webgpu)
      // A WebGL2-only machine, simulated at the only place the engine reads the capability:
      // `navigator.gpu` is absent, so no adapter and no device can be obtained.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
      });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${serverPort(server)}`);
    await page.evaluate(async (url) => {
      window.sdk = await import(url);
    }, '/sdk/sdk-browser/index.js');
    const cases: Record<string, CaseResult> = {};
    for (const request of requests)
      cases[request] = (await page.evaluate(runDefaultBackendCase, {
        manifestUrl: MANIFEST,
        key: request,
        request,
        repeats: request === 'autonomous' ? 0 : 3,
        frames: 140,
      })) as CaseResult;
    const image =
      cases.default?.backend && cases.witness?.backend
        ? await page.evaluate(compareDefaultBackendCaptures, ['default', 'witness'] as [
            string,
            string,
          ])
        : null;
    for (const key of Object.keys(cases)) {
      if (!cases[key].backend) continue;
      const url = await page.evaluate(defaultBackendCapturePng, key);
      const name = `${webgpu ? 'webgpu' : 'webgl2-only'}-${key === 'witness' ? 'before' : 'after'}`;
      await writeFile(resolve(out, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    await context.close();
    return { cases, image } as MachineResult;
  };
  const withGpu = await machine(true, ['default', 'witness', 'autonomous']);
  const withoutGpu = await machine(false, ['default', 'witness']);
  assert.equal(withGpu.cases.default.webgpu, true);
  assert.equal(withGpu.cases.default.backend, 'webgpu-page-raster');
  assert.equal(withGpu.cases.witness.backend, 'exact-cluster-pages');
  assert.equal(withoutGpu.cases.default.webgpu, false);
  // No device: the autonomous WebGL2 path is what the engine chooses, never a Three witness.
  assert.deepEqual(chosen(withoutGpu.cases.default), {
    kind: 'configuration',
    scope: 'full',
    origin: 'default',
    reason: 'no WebGPU device; the cache carries a prepared autonomous scene',
    autonomous: true,
    webgpuDevice: false,
  });
  assert.deepEqual(errors, []);
  const side = (name: string, run: MachineResult) => [
    name,
    {
      defaultBackend: run.cases.default.backend,
      defaultError: run.cases.default.error,
      defaultChoice: chosen(run.cases.default),
      previousDefaultBackend: run.cases.witness.backend,
      explicitAutonomousError: run.cases.autonomous?.error ?? null,
      imageAgainstPreviousDefault: run.image,
      cadence: { default: cadence(run.cases.default), previous: cadence(run.cases.witness) },
    },
  ];
  const result = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scene: `${SCENE} (35 840 selected triangles)`,
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
