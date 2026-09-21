// "honest measurement harness counters" batch: `measureView` metrics previously kept
// only `number`/`boolean` values from the last `explorer.render()` — an absent counter
// (`null`) disappeared from the report, indistinguishable to a reader from a counter never asked
// about. It now explicitly preserves `null`, and continues to filter out what is neither a
// number, nor a boolean, nor `null` (objects, arrays, `undefined`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureView } from './pageEclairage.ts';
import type { MeasureViewOptions } from './mesureOptions.ts';
import type { Explorer } from '../../packages/sdk-browser/index.ts';
import type { CameraPose } from '../../packages/sdk-core/index.ts';

/** The fake SDK that `measureView` imports by URL: a `createExplorer` returning the mock set
 *  on `globalThis` before the call, as Playwright serializes `measureView` into the real page. */
const FAKE_SDK_URL =
  'data:text/javascript,' +
  encodeURIComponent(
    `export const creerMoteur = () => {};
     export async function createExplorer() { return globalThis.__wgTestExplorer; }`,
  );

function canvasMock() {
  return { width: 8, height: 8, addEventListener: () => {}, remove: () => {} };
}

/** Explorer mock: `render()` returns the reading and records the pose it saw; `cpuSteps()`
 *  counts the images since the last profile reset, as the engine's window does. */
function explorerMock(metrics: Record<string, unknown> | null): Explorer & {
  seen: unknown[];
  profileResets: number[];
} {
  const seen: unknown[] = [],
    profileResets: number[] = [];
  return {
    seen,
    profileResets,
    backends: [{ id: 'moteur-test', scene: { children: [] } }],
    setDiagnostic: () => {},
    setPose: () => {},
    resetStageProfile: () => profileResets.push(seen.length),
    stageProfile: () => null,
    cpuSteps: () => ({ frames: seen.length - (profileResets.at(-1) ?? 0) }),
    render: (pose: unknown) => {
      seen.push(pose);
      return metrics;
    },
    flush: async () => {},
    capture: () => new Uint8Array(4),
    dispose: () => {},
  } as unknown as Explorer & { seen: unknown[]; profileResets: number[] };
}

/** What this test replaces on `globalThis` while `measureView` runs: only what the page module
 *  reads from the DOM and the platform, none of the rest of `Document`/`Window`. */
interface TestGlobals {
  document: unknown;
  fetch: unknown;
  requestAnimationFrame: unknown;
  incidentsGpu?: string[];
  __wgTestExplorer?: unknown;
}

/** Runs `measureView` on a mock page; `explorer` replaces the default mock, `options` the rest. */
async function mesurer(
  metrics: Record<string, unknown> | null,
  {
    frames = 1,
    rafStep = 0,
    explorer,
    ...options
  }: Partial<MeasureViewOptions> & { rafStep?: number; explorer?: unknown } = {},
) {
  const test = globalThis as unknown as TestGlobals;
  const originalDocument = test.document;
  const originalFetch = test.fetch;
  const originalRaf = test.requestAnimationFrame;
  test.document = { createElement: () => canvasMock(), body: { append: () => {} } };
  test.fetch = async () => ({ status: 200 });
  let rafTime = 0;
  test.requestAnimationFrame = (callback: (time: number) => void) => callback((rafTime += rafStep));
  test.__wgTestExplorer = explorer ?? explorerMock(metrics);
  const base: MeasureViewOptions = {
    sdkUrl: FAKE_SDK_URL,
    manifestUrl: 'manifest.json',
    modulesUrl: './',
    backend: 'creerMoteur',
    engineId: 'moteur-test',
    autonomous: false,
    witness: false,
    page: 'pageEclairage.ts',
    gltfUrl: null,
    pose: { position: [0, 0, 0], target: [0, 0, 0], fov: 55, near: 0.1, far: 100 },
    poses: null,
    width: 8,
    height: 8,
    pixelError: 1,
    frames,
    warmup: 0,
    maxPages: 4,
    geometryPoolBytes: null,
    texturePoolBytes: null,
    geometryPoolCeilingBytes: null,
    poolVivant: null,
    instances: 1,
    stageProfile: false,
    variant: null,
    errorMetric: null,
    trace: false,
    bounce: false,
    importedLights: true,
    profileFrames: 0,
    lights: [],
    moving: null,
    shadowBudgetMs: null,
    shadowPages: true,
    shadowDigest: false,
    textureSource: 'host',
    textureUploadMs: null,
    textureCompression: undefined,
    temporalAntialiasing: true,
    mathPath: null,
    movingNode: null,
    movingNodeRadius: 1,
    captureFile: 'test.png',
  };
  try {
    const result = await measureView({ ...base, ...options });
    if ('erreur' in result) throw new Error(result.erreur);
    return result;
  } finally {
    test.document = originalDocument;
    test.fetch = originalFetch;
    test.requestAnimationFrame = originalRaf;
    delete test.__wgTestExplorer;
  }
}

test('the measured moving loop publishes real requestAnimationFrame intervals', async () => {
  const result = await mesurer({ drawCalls: 1 }, { frames: 5, rafStep: 16.5 });
  assert.deepEqual(result.rafIntervalMs, [16.5, 16.5]);
});

test('measureView keeps an explicit `null` in metrics instead of erasing it', async () => {
  const { metrics } = await mesurer({ triangles: null, gpuSelectionFallback: null, drawCalls: 3 });
  assert.equal(metrics.triangles, null, '`null` must stay, not disappear from the reading');
  assert.equal(metrics.gpuSelectionFallback, null);
  assert.equal(metrics.drawCalls, 3, 'a measured number always passes');
  assert.ok('triangles' in metrics, 'the key itself must be present, not only `undefined`');
});

test('measureView keeps an explicit `false`, distinct from an absent counter', async () => {
  const { metrics } = await mesurer({ frameHeld: false, imageTenue: true });
  assert.equal(metrics.frameHeld, false);
  assert.equal(metrics.imageTenue, true);
});

test('measureView keeps a table of numbers — bytes per label — and filters the rest', async () => {
  const { metrics } = await mesurer({
    triangles: 500,
    gpuAllocatedByLabel: { 'WG display color': 4, unlabelled: 8 },
    scene: { nested: { deep: 1 } },
    pending: [1, 'two'],
    absent: undefined,
  });
  assert.equal(metrics.triangles, 500);
  assert.deepEqual(metrics.gpuAllocatedByLabel, { 'WG display color': 4, unlabelled: 8 });
  assert.equal('scene' in metrics, false, 'an object with a non-number value does not pass');
  assert.equal('pending' in metrics, false, 'an array neither');
  assert.equal('absent' in metrics, false, '`undefined` stays an absence, not a published value');
});

test('stage profile covers the moving suffix and capture keeps its last pose', async () => {
  const a: CameraPose = { position: [1, 0, 0], target: [0, 0, 0], fov: 55, near: 0.1, far: 100 },
    b: CameraPose = { position: [2, 0, 0], target: [0, 0, 0], fov: 55, near: 0.1, far: 100 };
  const explorer = explorerMock({ drawCalls: 1 });
  await mesurer(null, {
    explorer,
    frames: 2,
    poses: [a, b],
    pose: a,
    stageProfile: true,
    profileFrames: 1,
  });
  assert.deepEqual(explorer.profileResets, [1], 'profile starts inside the measured path');
  assert.ok(explorer.seen.length > 2, 'capture work follows measured frames');
  const afterMeasured = explorer.seen.slice(2);
  for (const pose of afterMeasured) {
    assert.equal(pose, b, 'capture pose is the last measured pose, not poseAt(0)');
  }
});

test('the CPU bounds cover the profiled images only: none of the warm-up, none of the capture', async () => {
  const result = await mesurer(
    { drawCalls: 1 },
    { frames: 3, stageProfile: true, profileFrames: 2 },
  );
  assert.deepEqual(result.bornesCpu, { frames: 2 });
});
