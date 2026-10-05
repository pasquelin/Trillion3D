// A session's pools are those of its first admission (`sessionPools`): a byte the frame frees later
// stays free, never handed to a pool; they shrink when room runs short and come back up to that
// grant, and only a pool the page asks passes it. By default, the frame's share and an effect chain
// past its reserve are funded before them (`defaultGpuBudget`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionPools, worldPools } from './worldBudget.ts';
import type { ActiveGpuMemory } from '../../residency/activeMemory.ts';
import { DEFAULT_BUDGET_CANVAS, defaultGpuBudget } from '../../residency/memoryBudget.ts';
import { effectTargetReserve } from '../../residency/effectReserve.ts';
import { SHADOW_POOL_BYTES } from '../../residency/shadowBudgetBytes.ts';
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../../residency/pools.ts';

const MiB = 2 ** 20;
/** A session holding `frameTargets` beside 400 MiB of shadows, its pools' floors 64 and 32 MiB. */
const holding = (frameTargets: number, more: Partial<ActiveGpuMemory> = {}): ActiveGpuMemory => ({
  frameTargets,
  frameShare: frameTargets,
  shadowPool: 400 * MiB,
  shadowReserve: 0,
  bounceProbes: 0,
  effectTargets: 0,
  geometryMinimum: 64 * MiB,
  textureMinimum: 32 * MiB,
  ...more,
});

test('a byte the frame frees stays free: the pools keep their first grant', () => {
  const world = Object.assign(worldPools(), { gpu: 2048 * MiB });
  const { admitGpuMemory } = sessionPools(world);
  const first = admitGpuMemory(holding(1200 * MiB));
  assert.deepEqual(first, { geometryPoolBytes: 224 * MiB, texturePoolBytes: 224 * MiB });
  assert.deepEqual(admitGpuMemory(holding(1000 * MiB)), first, '200 MiB freed, none to a pool');
  // Room short: they shrink as ever, then come back up to the grant, never past it.
  const short = admitGpuMemory(holding(1400 * MiB));
  assert.deepEqual(short, { geometryPoolBytes: 124 * MiB, texturePoolBytes: 124 * MiB });
  assert.deepEqual(admitGpuMemory(holding(900 * MiB)), first);
});

test('only a pool the page asks passes the first grant', () => {
  const world = Object.assign(worldPools(), { gpu: 2048 * MiB });
  const { admitGpuMemory } = sessionPools(world);
  admitGpuMemory(holding(1200 * MiB));
  world.geometryPool = 300 * MiB;
  const asked = admitGpuMemory(holding(1000 * MiB));
  assert.equal(asked.geometryPoolBytes, 300 * MiB, 'asked, within the split');
  assert.equal(asked.texturePoolBytes, 224 * MiB, 'the other kept at its grant');
});

test('a new session is granted again', () => {
  const world = Object.assign(worldPools(), { gpu: 2048 * MiB });
  sessionPools(world).admitGpuMemory(holding(1200 * MiB));
  const reopened = sessionPools(world).admitGpuMemory(holding(1000 * MiB));
  assert.deepEqual(reopened, { geometryPoolBytes: 324 * MiB, texturePoolBytes: 324 * MiB });
});

/** `holding` the shadows' share exactly: `defaultGpuBudget` takes the larger of it and what is held. */
const atShare = (frameTargets: number, more: Partial<ActiveGpuMemory> = {}) =>
  holding(frameTargets, { shadowPool: SHADOW_POOL_BYTES, ...more });

test('the default total funds the frame share and a chain past its reserve before the pools', () => {
  const world = worldPools();
  const { admitGpuMemory } = sessionPools(world);
  assert.equal(admitGpuMemory.limit(), defaultGpuBudget(), 'before any admission: the shares');
  const reserve = effectTargetReserve(DEFAULT_BUDGET_CANVAS);
  const active = atShare(1100 * MiB, { frameShare: 1180 * MiB, effectTargets: reserve + 10 * MiB });
  const pools = admitGpuMemory(active);
  assert.equal(admitGpuMemory.limit(), defaultGpuBudget() + 1180 * MiB + 10 * MiB);
  assert.deepEqual(pools, {
    geometryPoolBytes: DEFAULT_GEOMETRY_POOL_BUDGET,
    texturePoolBytes: DEFAULT_TEXTURE_POOL_BUDGET,
  });
  // A chain within its reserve adds nothing.
  admitGpuMemory(atShare(1100 * MiB, { frameShare: 1180 * MiB, effectTargets: reserve - MiB }));
  assert.equal(admitGpuMemory.limit(), defaultGpuBudget() + 1180 * MiB);
});

test("a scene whose floors pass the pools' defaults: the default total funds them", () => {
  const { admitGpuMemory } = sessionPools(worldPools());
  const floors = { geometryMinimum: 700 * MiB, textureMinimum: 600 * MiB };
  const pools = admitGpuMemory(atShare(1100 * MiB, floors));
  assert.equal(admitGpuMemory.limit(), defaultGpuBudget() + 1100 * MiB + (700 + 600 - 1024) * MiB);
  assert.deepEqual(pools, { geometryPoolBytes: 700 * MiB, texturePoolBytes: 600 * MiB });
});

test('shadows still to be made past their share: the default total funds them, pools whole', () => {
  const { admitGpuMemory } = sessionPools(worldPools());
  const pools = admitGpuMemory(
    holding(1100 * MiB, { shadowPool: 80 * MiB, shadowReserve: 700 * MiB }),
  );
  assert.equal(
    admitGpuMemory.limit() - defaultGpuBudget(),
    1100 * MiB + 780 * MiB - SHADOW_POOL_BYTES,
  );
  assert.deepEqual(pools, {
    geometryPoolBytes: DEFAULT_GEOMETRY_POOL_BUDGET,
    texturePoolBytes: DEFAULT_TEXTURE_POOL_BUDGET,
  });
});

test('by default no grant is held: a first admission squeezed by bytes since freed recovers', () => {
  const { admitGpuMemory } = sessionPools(worldPools());
  const squeezed = admitGpuMemory(holding(1100 * MiB, { frameShare: 300 * MiB }));
  assert.ok(squeezed.geometryPoolBytes < DEFAULT_GEOMETRY_POOL_BUDGET);
  assert.deepEqual(admitGpuMemory(holding(300 * MiB)), {
    geometryPoolBytes: DEFAULT_GEOMETRY_POOL_BUDGET,
    texturePoolBytes: DEFAULT_TEXTURE_POOL_BUDGET,
  });
});

test('a held grant is never under a floor risen since', () => {
  const world = Object.assign(worldPools(), { gpu: 2048 * MiB });
  const { admitGpuMemory } = sessionPools(world);
  admitGpuMemory(holding(1200 * MiB));
  const risen = admitGpuMemory(holding(1000 * MiB, { geometryMinimum: 300 * MiB }));
  assert.equal(risen.geometryPoolBytes, 300 * MiB);
});

test("a session opens on its own holdings, not the last session's", () => {
  const world = worldPools();
  sessionPools(world).admitGpuMemory(holding(4000 * MiB));
  const { admitGpuMemory } = sessionPools(world);
  assert.equal(admitGpuMemory.limit(), defaultGpuBudget());
});
