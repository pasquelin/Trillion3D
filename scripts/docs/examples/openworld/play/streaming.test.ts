import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseKey,
  planStream,
  tileDistance,
  tileIndex,
  tileKey,
  tilesAround,
  type StreamLimits,
  type TileKey,
} from '../../../../../site/examples/kit/openworld/play/grid.ts';
import { heightAt, heightStore } from '../../../../../site/examples/kit/openworld/play/heights.ts';
import { SAMPLES, slope, tileHeights } from './fixture.ts';

const GRID = { size: 50_000, tile: 1_000 };
const LIMITS: StreamLimits = { radius: 2500, lookahead: 12, fetches: 6, builds: 2, cache: 96 };
const none = new Set<TileKey>();

test('tiles are numbered from the map corner and those around a point come nearest first', () => {
  assert.equal(tileIndex(GRID, -25_000), 0);
  assert.equal(tileIndex(GRID, 24_999), 49);
  const around = tilesAround(GRID, 500, 500, 2400);
  assert.equal(around[0], tileKey(25, 25));
  for (const key of around) assert.ok(tileDistance(GRID, ...parseKey(key), 500, 500) <= 2400);
  // From a tile's centre, 2.4 km reaches two tiles each way and the corners between them.
  assert.equal(around.length, 25);
  // At the map's edge the set stops at the last tile.
  assert.ok(tilesAround(GRID, -24_900, 0, 2500).every((key) => Number(key.split('_')[0]) >= 0));
});

test('a standing player builds the ring around it, a few bodies a step, fetching what it lacks', () => {
  const at = { x: 500, z: 500, vx: 0, vz: 0 };
  const first = planStream(GRID, at, { cached: none, fetching: none, built: none }, LIMITS);
  assert.equal(first.fetch.length, LIMITS.fetches);
  assert.equal(first.fetch[0], tileKey(25, 25));
  assert.deepEqual(first.build, []);
  const cached = new Set(tilesAround(GRID, 500, 500, 2500));
  const next = planStream(GRID, at, { cached, fetching: none, built: none }, LIMITS);
  assert.deepEqual(next.fetch, []);
  assert.deepEqual(next.build, [...cached].slice(0, LIMITS.builds));
});

test('heights ahead of the travel are fetched before the player needs them', () => {
  const near = new Set(tilesAround(GRID, 500, 500, 2500));
  const plan = planStream(
    GRID,
    { x: 500, z: 500, vx: 250, vz: 0 },
    { cached: near, fetching: none, built: near },
    { ...LIMITS, fetches: 100 },
  );
  // 250 m/s for 12 s: the ring three kilometres east is asked for, beyond the bodies' radius.
  assert.ok(plan.fetch.includes(tileKey(30, 25)));
  assert.ok(plan.fetch.every((key) => !near.has(key)));
});

test('bodies are released only past the radius and half a tile, far heights evicted first', () => {
  const built = new Set([tileKey(25, 25), tileKey(28, 25), tileKey(29, 25)]);
  const cached = new Set([...built, tileKey(40, 40), tileKey(10, 10), tileKey(26, 25)]);
  const plan = planStream(
    GRID,
    { x: 500, z: 500, vx: 0, vz: 0 },
    { cached, fetching: none, built },
    { ...LIMITS, cache: 5 },
  );
  // Tile 28 lies 2.5 km away (kept, inside the half-tile margin); tile 29, 3.5 km, goes.
  assert.deepEqual(plan.release, [tileKey(29, 25)]);
  assert.deepEqual(plan.evict, [tileKey(40, 40)]);
});

test('a failed fetch is not asked for again', () => {
  const failed = new Set([tileKey(25, 25)]);
  const plan = planStream(
    GRID,
    { x: 500, z: 500, vx: 0, vz: 0 },
    { cached: none, fetching: none, built: none, failed },
    LIMITS,
  );
  assert.ok(!plan.fetch.includes(tileKey(25, 25)));
});

test("the ground height is read between a tile's samples", () => {
  const store = heightStore({ size: 8000, tile: 1000 }, SAMPLES);
  assert.equal(heightAt(store, 10, 10), null);
  store.tiles.set(tileKey(4, 4), tileHeights(4, 4));
  for (const [x, z] of [
    [10, 10],
    [517.3, 999.9],
    [0, 0],
  ])
    assert.ok(Math.abs(heightAt(store, x, z)! - slope(x, z)) < 1e-3);
});
