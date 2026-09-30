import assert from 'node:assert/strict';
import test from 'node:test';
import { geometryPoolFor } from './pools.ts';
import { laneCounts, poolEncoding } from '../texture/blockFormats.ts';
import { TILES_PER_LAYER } from '../texture/tiles.ts';
import { texturePoolFor } from '../webgpu/residency/memoryBudgets.ts';
import { DEFAULT_CPU_BUDGET, splitMemoryBudget } from './memoryBudget.ts';
import type { ActiveGpuMemory } from './activeMemory.ts';
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts';
import { defaultGpuBudget, SHADOW_GRANT_BYTES } from './memoryBudget.ts';
import { SHADOW_BATCH_GPU_BYTES } from '../gpu/shadow/batchBudget.ts';
import { bounceProbeBytes } from '../bounce/limits.ts';
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts';

const DEFAULT_GPU_BUDGET = defaultGpuBudget();
const SHADOW_POOL_BYTES = SHADOW_GRANT_BYTES + SHADOW_BATCH_GPU_BYTES;
const BOUNCE_PROBE_BYTES =
  2 * bounceProbeBytes(BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3);

// The million-page/300-root pool fixture of pools.test.ts, using the actual floor rule.
const geometryMinimum = geometryPoolFor({
  budgetBytes: 1,
  pageBytes: 1500,
  uniquePages: 1_000_000,
  rootPages: 300,
}).allocatedBytes;
// The asymmetric tail fixture of poolGrants.test.ts, using its real lane/layer rule.
const encoding = poolEncoding('bc7');
const textureMinimum = texturePoolFor(
  1,
  undefined,
  {
    color: { ...laneCounts(), lossless: 5000 },
    data: { ...laneCounts(), rgba: 20000 },
  },
  encoding.texelBytes,
  {
    color: { ...laneCounts(), lossless: 2 * TILES_PER_LAYER + 1 },
    data: laneCounts(),
  },
).allocatedBytes;
const full: ActiveGpuMemory = {
  frameTargets: 1274573696,
  shadowPool: SHADOW_POOL_BYTES,
  bounceProbes: BOUNCE_PROBE_BYTES,
  effectTargets: 22112160,
  geometryMinimum,
  textureMinimum,
};

test('active admission uses real pool floors and does not charge inactive fixed reservations', () => {
  const active = { ...full, shadowPool: 0, effectTargets: 0 };
  const split = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, active);
  assert.equal(split.shadowPool, 0);
  assert.equal(split.effectTargets, 0);
  assert.equal(split.frameTargets, active.frameTargets);
  assert.ok(split.geometryPool >= geometryMinimum);
  assert.ok(split.texturePool >= textureMinimum);
  assert.ok(
    split.geometryPool + split.texturePool + active.frameTargets + active.bounceProbes <=
      DEFAULT_GPU_BUDGET,
  );
});

test('the asymmetric real tail floor is admitted exactly or refused, never silently raised', () => {
  assert.equal(geometryMinimum, 450000);
  assert.equal(textureMinimum, 218103808);
  const active = { ...full, shadowPool: 0, effectTargets: 0, bounceProbes: 0 };
  const exact = active.frameTargets + geometryMinimum + textureMinimum;
  const split = splitMemoryBudget(exact, DEFAULT_CPU_BUDGET, undefined, active);
  assert.equal(split.geometryPool, geometryMinimum);
  assert.equal(split.texturePool, textureMinimum);
  assert.throws(
    () => splitMemoryBudget(exact - 1, DEFAULT_CPU_BUDGET, undefined, active),
    /UNDER_MINIMUM/,
  );
});

test('full 4K reservations expose the concrete tail-fixture shortfall instead of overcommitting', () => {
  assert.throws(
    () => splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, full),
    /UNDER_MINIMUM/,
  );
  const withoutHistory = { ...full, frameTargets: full.frameTargets - 265420800 };
  const prior = splitMemoryBudget(
    DEFAULT_GPU_BUDGET,
    DEFAULT_CPU_BUDGET,
    undefined,
    withoutHistory,
  );
  assert.ok(prior.texturePool >= textureMinimum);
});

test('invalid reservations cannot create artificial space in the global budget', () => {
  for (const value of [-1, NaN, Infinity, 0.5])
    assert.throws(
      () =>
        splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, {
          ...full,
          frameTargets: value,
        }),
      /INVALID_GPU_RESERVATION/,
    );
});

test('the existing open-world cell fixture keeps its pinned top and held-cell roots beside 4K history', () => {
  const { table } = worldRootsFixture();
  const held = new Set([0, ...table.cells[0].objects.flatMap((object) => object.dependencies)]);
  const roots = [...held].reduce((count, bundle) => count + table.bundles[bundle].count, 0);
  const pageBytes = Math.max(...table.bundles.map((bundle) => bundle.bytes / bundle.count));
  const floor = geometryPoolFor({
    budgetBytes: 1,
    pageBytes,
    uniquePages: table.pages.length,
    rootPages: roots,
  });
  const active = {
    ...full,
    geometryMinimum: floor.allocatedBytes,
    textureMinimum: 0,
    shadowPool: 0,
    effectTargets: 0,
  };
  const split = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, active);
  const pool = geometryPoolFor({
    budgetBytes: split.geometryPool,
    pageBytes,
    uniquePages: table.pages.length,
    rootPages: roots,
  });
  assert.equal(roots, 3, 'world top plus both bundles required by the placed cell');
  assert.ok(pool.slots >= roots);
  assert.ok(
    split.geometryPool + split.texturePool + active.frameTargets + active.bounceProbes <=
      DEFAULT_GPU_BUDGET,
  );
});
