import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import { camera, quadBackend } from '../testScenes.fixture.ts';
import { setWebgpuMemoryBudgets } from './memory.ts';
import { geometryPoolFor } from '../../../residency/pools.ts';

// The engine changes pools mid-session — what an application slider calls — without preparing
// again and without losing the image: the report says what it actually holds.
test('setMemoryBudgets sets the pools in session, brings them back by name, and the image continues', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  // Two 12-byte root pages: a one-page budget is raised to root coverage.
  const { fixture, backend } = quadBackend(device, {
    maxResidentPages: undefined,
    geometryPoolBytes: 12,
  });
  try {
    await backend.prepare();
    backend.render(camera());
    const before = backend.metrics();
    assert.deepEqual(
      [before.geometryPoolBytes, before.geometryPoolSlots, before.geometryPoolClamp],
      [12, 2, 'root-cover'],
    );
    // More than the scene has pages: brought back to the scene, by name, nothing is evicted.
    const grown = await backend.setMemoryBudgets!({ geometryPoolBytes: 1024 * 1024 * 1024 });
    assert.deepEqual([grown.geometryPool.clamp, grown.geometryPool.slots], ['scene', 2]);
    assert.equal(grown.evictedPages, 0);
    // Under root coverage: raised to it, by name; roots never leave.
    const shrunk = await backend.setMemoryBudgets!({ geometryPoolBytes: 1, texturePoolBytes: 1 });
    assert.equal(shrunk.geometryPool.clamp, 'root-cover');
    assert.equal(shrunk.texturePool?.clamp, 'minimum');
    assert.equal(shrunk.texturePool?.layers.color.lossless, 1);
    assert.ok(shrunk.durationMs >= 0);
    backend.render(camera());
    const after = backend.metrics();
    assert.equal(after.geometryPoolSlots, shrunk.geometryPool.slots);
    assert.equal(after.geometryPoolClamp, 'root-cover');
    assert.equal(after.coverageReady, true);
    assert.equal(after.texturePoolClamp, 'minimum');
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('a setting above the session ceiling is brought back to the ceiling, and the cache resized once', async () => {
  const resized: number[] = [],
    unpinned: number[] = [];
  let resources = 0;
  const setup = {
    cap: 4,
    geometryPool: { slots: 2 },
    texturePool: { layers: 1 },
    gpuDevice: fakeDevice({ limits: {} }).device,
    geometryPoolFor: (budgetBytes: number) =>
      geometryPoolFor({
        budgetBytes,
        pageBytes: 8,
        uniquePages: 100,
        rootPages: 1,
        ceilingSlots: 4,
      }),
    tracking: {
      pageCatalogIds: new Map([['p', 7]]),
      unmarkPinned: (k: number) => unpinned.push(k),
    },
    get slots() {
      return this.geometryPool.slots;
    },
  };
  const rt = {
    setup,
    gpu: {
      cache: {
        resize: async (n: number) => (resized.push(n), ['p']),
        stats: () => ({ residentPages: 3 }),
      },
    },
    vis: {},
    run: { lost: false, gate: { resourcesChanged: () => resources++ } },
    diag: { engineDiagnostic() {} },
  };
  const report = await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 800 });
  assert.deepEqual([report.geometryPool.clamp, report.geometryPool.slots], ['ceiling', 4]);
  assert.deepEqual(resized, [4]);
  assert.deepEqual(unpinned, [7], 'the evicted page is unpinned on the trace side');
  assert.equal(report.evictedPages, 1);
  assert.deepEqual(report.residentPages, { before: 3, after: 3 });
  assert.equal(setup.slots, 4);
  assert.equal(resources, 1);
  // The same value again: nothing to resize.
  await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 800 });
  assert.deepEqual(resized, [4]);
});

// Behaviour: a texture budget set before prepare is kept, not drawn — the lane pools need the
// catalogue —, the report says so with `null`, and prepare draws the pools at that budget.
test('a texture budget set before prepare is kept and drawn by prepare, the report saying null', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const { fixture, backend } = quadBackend(device, { maxResidentPages: undefined });
  try {
    const early = await backend.setMemoryBudgets!({ texturePoolBytes: 1 });
    assert.equal(early.texturePool, null);
    assert.equal(backend.metrics().texturePoolClamp, null);
    await backend.prepare();
    backend.render(camera());
    assert.equal(backend.metrics().texturePoolClamp, 'minimum', 'drawn at the one-byte budget');
    const after = await backend.setMemoryBudgets!({});
    assert.equal(after.texturePool?.budgetBytes, 1);
    await assert.rejects(
      backend.setMemoryBudgets!({ texturePoolBytes: 0 }),
      /INVALID_TEXTURE_POOL_BUDGET/,
    );
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

// Out of memory absorbed: a pool the device refuses is drawn smaller, the pool in place replaced
// only by one it grants, a diagnostic names the pool and the bytes, and nothing reaches the page.
test('a geometry pool the device refuses mid-session shrinks, and the session goes on', async () => {
  const gpu = fakeDevice({
    limits: {},
    refuse: ({ size }) => ((size as number) > 16 ? 'oom' : undefined),
  });
  const resized: number[] = [],
    diagnostics: Array<[string, Record<string, unknown>]> = [];
  const setup = {
    geometryPool: geometryPoolFor({ budgetBytes: 8, pageBytes: 8, uniquePages: 100, rootPages: 1 }),
    geometryPoolFor: (budgetBytes: number) =>
      geometryPoolFor({ budgetBytes, pageBytes: 8, uniquePages: 100, rootPages: 1 }),
    tracking: { pageCatalogIds: new Map(), unmarkPinned() {} },
    get slots() {
      return this.geometryPool.slots;
    },
  };
  const run = { lost: false, gate: { resourcesChanged() {} } };
  const rt = {
    setup,
    gpu: {
      device: gpu.device,
      cache: { resize: async (n: number) => (resized.push(n), []), stats: () => ({}) },
      vertexBytes: 0,
    },
    vis: {},
    run,
    diag: {
      engineDiagnostic: (phase: string, _message: string, context: Record<string, unknown>) =>
        diagnostics.push([phase, context]),
    },
  };
  const report = await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 64 });
  // 64 → 32 → 16 bytes: two slots, what the device grants.
  assert.deepEqual(resized, [2]);
  assert.equal(report.geometryPool.slots, 2);
  assert.equal(run.lost, false);
  assert.deepEqual(diagnostics[0], [
    'gpu-out-of-memory',
    { kind: 'warning', pool: 'geometry', requestedBytes: 64, grantedBytes: 16, clamp: null },
  ]);
  assert.equal(gpu.scopes.length, 0);
});
