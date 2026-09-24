import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
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
    gpuDevice: { limits: {} },
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
