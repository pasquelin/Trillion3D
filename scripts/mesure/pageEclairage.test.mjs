// "honest measurement harness counters" batch: `measureView` metrics previously kept
// only `number`/`boolean` values from the last `explorer.render()` — an absent counter
// (`null`) disappeared from the report, indistinguishable to a reader from a counter never asked
// about. It now explicitly preserves `null`, and continues to filter out what is neither a
// number, nor a boolean, nor `null` (objects, arrays, `undefined`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureView } from './pageEclairage.mjs';

/** The fake SDK that `measureView` imports by URL: a `createExplorer` returning the mock set
 *  on `globalThis` before the call, as Playwright serializes `measureView` into the real page. */
const FAKE_SDK_URL =
  'data:text/javascript,' +
  encodeURIComponent(
    `export const creerMoteur = () => {};
     export async function createExplorer(canvas, options) {
       globalThis.__wgTestOptions = options;
       return globalThis.__wgTestExplorer;
     }`,
  );

function canvasMock() {
  return { width: 8, height: 8, addEventListener: () => {}, remove: () => {} };
}

/** Explorer mock: `render()` returns the reading and records the pose it saw. */
function explorerMock(metrics) {
  const seen = [],
    profileResets = [];
  return {
    seen,
    profileResets,
    backends: [{ id: 'moteur-test', scene: { children: [] } }],
    setDiagnostic: () => {},
    setPose: () => {},
    resetStageProfile: () => profileResets.push(seen.length),
    stageProfile: () => null,
    render: (pose) => {
      seen.push(pose);
      return metrics;
    },
    flush: async () => {},
    capture: () => new Uint8Array(4),
    dispose: () => {},
  };
}

async function mesurer(metrics, { frames = 1, rafStep = 0 } = {}) {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.document = { createElement: () => canvasMock(), body: { append: () => {} } };
  globalThis.fetch = async () => ({ status: 200 });
  let rafTime = 0;
  globalThis.requestAnimationFrame = (callback) => callback((rafTime += rafStep));
  globalThis.__wgTestExplorer = explorerMock(metrics);
  try {
    return await measureView({
      sdkUrl: FAKE_SDK_URL,
      modulesUrl: './',
      backend: 'creerMoteur',
      engineId: 'moteur-test',
      width: 8,
      height: 8,
      pixelError: 1,
      maxPages: 4,
      warmup: 0,
      frames,
      pose: { position: [0, 0, 0] },
      captureFile: 'test.png',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalRaf;
    delete globalThis.__wgTestExplorer;
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
  const a = { position: [1, 0, 0] },
    b = { position: [2, 0, 0] };
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalRaf = globalThis.requestAnimationFrame;
  const explorer = explorerMock({ drawCalls: 1 });
  globalThis.document = { createElement: () => canvasMock(), body: { append: () => {} } };
  globalThis.fetch = async () => ({ status: 200 });
  globalThis.requestAnimationFrame = (cb) => cb(0);
  globalThis.__wgTestExplorer = explorer;
  try {
    await measureView({
      sdkUrl: FAKE_SDK_URL,
      modulesUrl: './',
      backend: 'creerMoteur',
      engineId: 'moteur-test',
      width: 8,
      height: 8,
      pixelError: 1,
      maxPages: 4,
      warmup: 0,
      frames: 2,
      poses: [a, b],
      pose: a,
      stageProfile: true,
      profileFrames: 1,
      captureFile: 'test.png',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalRaf;
    delete globalThis.__wgTestExplorer;
  }
  assert.deepEqual(explorer.profileResets, [1], 'profile starts inside the measured path');
  assert.ok(explorer.seen.length > 2, 'capture work follows measured frames');
  const afterMeasured = explorer.seen.slice(2);
  for (const pose of afterMeasured) {
    assert.equal(pose, b, 'capture pose is the last measured pose, not poseAt(0)');
  }
});

test('a cpu-timing report published after the measured loop names no measured image', async () => {
  const explorer = explorerMock({ drawCalls: 1 });
  const report = { frame: 3, totalMs: 1, lightsMs: 0, selectionMs: 0, steps: null };
  const publish = () =>
    globalThis.__wgTestOptions.onDiagnostic({ phase: 'cpu-timing', context: report });
  explorer.render = (pose) => (explorer.seen.push(pose), publish(), { drawCalls: 1 });
  explorer.flush = async () => publish();
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.document = { createElement: () => canvasMock(), body: { append: () => {} } };
  globalThis.fetch = async () => ({ status: 200 });
  globalThis.requestAnimationFrame = (cb) => cb(0);
  globalThis.__wgTestExplorer = explorer;
  let result;
  try {
    result = await measureView({
      sdkUrl: FAKE_SDK_URL,
      modulesUrl: './',
      backend: 'creerMoteur',
      engineId: 'moteur-test',
      width: 8,
      height: 8,
      pixelError: 1,
      maxPages: 4,
      warmup: 0,
      frames: 2,
      pose: { position: [1, 0, 0] },
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalRaf;
    delete globalThis.__wgTestExplorer;
    delete globalThis.__wgTestOptions;
  }
  const images = result.bornesCpu.map((entry) => entry.image);
  assert.deepEqual(images.slice(0, 2), [0, 1], 'reports inside the loop carry their image');
  assert.equal(images.at(-1), null, 'a report after the loop carries no measured image');
});
