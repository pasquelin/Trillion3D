// Standalone proof of #274 and #297: with no `backends` option the active backend is the WebGPU
// page raster where a device exists, and the engine's own `autonomous-pages-webgl` where none
// does — the engine draws on a WebGL2-only machine, with no witness mounted at all. On both
// machines it records, on the same scene, camera, size and commit, the image and the rAF cadence
// of the default against the pre-#274 witness list, how many pixels the default actually drew,
// and the frame's own `selectedTriangles` against its `submittedTriangles`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { startServer } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { runDefaultBackendCase, type DefaultBackendCase } from '../support/defaultBackendCase.ts';
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

type ImageDelta = ReturnType<typeof compareDefaultBackendCaptures> | null;
type Drawn = ReturnType<typeof countDrawnPixels> | null;
type MachineResult = {
  cases: Record<string, CaseResult>;
  image: ImageDelta;
  captures: string[];
  drawn: Drawn;
};

const root = resolve(import.meta.dirname, '../../..');
const out = resolve(root, 'benchmark-runs/default-backend');
await mkdir(out, { recursive: true });
const SCENE = 'site/assets/kinetic-garden';
const MANIFEST = '/cache/scene/manifest.json';
const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
/** Median of a series per repeat, then the spread those repeat medians span. */
function spread(runs: number[][]) {
  const medians = runs.map((run) => quantile(run, 0.5));
  const all = runs.flat();
  if (!all.length) return null;
  return {
    frames: all.length,
    medianMs: Number(quantile(all, 0.5).toFixed(3)),
    p05Ms: Number(quantile(all, 0.05).toFixed(3)),
    p95Ms: Number(quantile(all, 0.95).toFixed(3)),
    repeatMediansMs: medians.map((value) => Number(value.toFixed(3))),
    repeatSpreadMs: Number((Math.max(...medians) - Math.min(...medians)).toFixed(3)),
  };
}
/** rAF interval, display-capped: the cadence is a ceiling, never the frame's own cost. */
function cadence(result: CaseResult) {
  const read = spread(result.runs);
  return read && { ...read, fpsFromMedian: Number((1000 / read.medianMs).toFixed(1)) };
}
/** The engine's own CPU frame cost over the same frames; never added to a GPU duration. */
const cpuFrame = (result: CaseResult) => spread(result.cpuRuns);
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
    const { context, page } = await openMachine({ browser, server, webgpu, errors });
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
    const drawn = cases.default?.backend
      ? ((await page.evaluate(countDrawnPixels, 'default')) as Drawn)
      : null;
    const captures: string[] = [];
    for (const key of Object.keys(cases)) {
      if (!cases[key].backend) continue;
      const url = await page.evaluate(defaultBackendCapturePng, key);
      const role = key === 'witness' ? 'before' : key === 'autonomous' ? 'autonomous' : 'after';
      const name = `${machineLabel(webgpu)}-${role}`;
      await writeFile(resolve(out, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
      captures.push(`${name}.png`);
    }
    await context.close();
    return { cases, image, captures, drawn } as MachineResult;
  };
  const withGpu = await machine(true, ['default', 'witness', 'autonomous']);
  const withoutGpu = await machine(false, ['default', 'witness']);
  // `tri = selected` is read on the CPU cut alone: the GPU path publishes its submitted count
  // after a readback, so the captured frame has none yet and the equality is `null` there.
  const triEqualsSelected = (result: CaseResult) =>
    result.backend === 'autonomous-pages-webgl' && result.metrics
      ? result.metrics.selectedTriangles === result.metrics.submittedTriangles
      : null;
  assert.equal(withGpu.cases.default.webgpu, true);
  assert.equal(withGpu.cases.default.backend, 'webgpu-page-raster');
  assert.equal(withGpu.cases.witness.backend, 'exact-cluster-pages');
  assert.equal(withoutGpu.cases.default.webgpu, false);
  // No device: the engine's own WebGL2 path prepares and draws, and it is the only one mounted.
  assert.equal(withoutGpu.cases.default.error, null);
  assert.equal(withoutGpu.cases.default.backend, 'autonomous-pages-webgl');
  assert.deepEqual(withoutGpu.cases.default.mounted, ['autonomous-pages-webgl']);
  assert.equal(withGpu.cases.autonomous?.error, null);
  assert.equal(withGpu.cases.autonomous?.backend, 'autonomous-pages-webgl');
  assert.deepEqual(chosenBackend(withoutGpu.cases.default), {
    kind: 'configuration',
    scope: 'full',
    origin: 'default',
    reason: 'no WebGPU device; the cache carries a prepared autonomous scene',
    renderer: 'autonomous-pages-webgl',
    autonomous: true,
    webgpuDevice: false,
    // This path samples the host images, so the loader opens them whatever the option says
    // (#289): a session that skipped them would draw the one-pixel placeholder.
    textureSource: 'host',
  });
  assert.equal(chosenBackend(withGpu.cases.default)?.textureSource, 'cache');
  // The cut it drew has no hole: every selected triangle was submitted.
  assert.ok(
    triEqualsSelected(withoutGpu.cases.default),
    JSON.stringify(withoutGpu.cases.default.metrics),
  );
  // The canvas is not empty: a twentieth of it at least differs from the cleared background.
  for (const run of [withGpu, withoutGpu])
    assert.ok(run.drawn && run.drawn.drawn > run.drawn.totalPixels / 20, JSON.stringify(run.drawn));
  assert.deepEqual(errors, []);
  const side = (name: string, run: MachineResult) => [
    name,
    {
      defaultBackend: run.cases.default.backend,
      defaultError: run.cases.default.error,
      defaultChoice: chosenBackend(run.cases.default),
      previousDefaultBackend: run.cases.witness.backend,
      explicitAutonomousError: run.cases.autonomous?.error ?? null,
      defaultMounted: run.cases.default.mounted,
      defaultCapabilities: run.cases.default.capabilities,
      defaultMetrics: run.cases.default.metrics,
      triEqualsSelected: triEqualsSelected(run.cases.default),
      imageAgainstPreviousDefault: run.image,
      defaultDrawnPixels: run.drawn,
      captures: run.captures,
      cadence: { default: cadence(run.cases.default), previous: cadence(run.cases.witness) },
      cpuFrameMs: { default: cpuFrame(run.cases.default), previous: cpuFrame(run.cases.witness) },
    },
  ];
  const result = {
    // Every number below is reproduced by re-running this file; the captures land beside it.
    captureDirectory: relative(root, out),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scene: `${SCENE} (35 840 selected triangles)`,
    viewport: { width: 480, height: 320, devicePixelRatio: 1 },
    settings: { pixelError: 0, temporalAntialiasing: false, scope: 'full' },
    // The cadence is read on a camera that turns by a milliradian per frame: a still scene holds
    // its frame by design. `fpsFromMedian` is capped by the display, 60 Hz on this machine.
    cadenceProtocol: 'orbiting camera, 140 frames per repeat, first 20 dropped, 3 repeats',
    machines: Object.fromEntries([side('webgpu', withGpu), side('webgl2-only', withoutGpu)]),
  };
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
