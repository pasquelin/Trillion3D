import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades, type BounceCascadeLevel } from './cascades.ts';
import { BOUNCE_SETTINGS } from './contracts.ts';
import { near } from '../math/near.fixture.ts';

const { cascadeLevels, cascadeSize, cascadeSpacingMetres, cascadeLayersAcross, cascadeShares } =
  BOUNCE_SETTINGS;

/** Extents of every shape: cubes, long slabs, thin sheets and flat planes, by size per axis. */
const SIZES = [
  ...Array.from({ length: 120 }, (_, i) => [i + 1, i + 1, i + 1]),
  ...Array.from({ length: 300 }, (_, i) => [i + 1, 3, 3]),
  ...Array.from({ length: 60 }, (_, i) => [7 * i + 0.3, 0.2 * i + 0.1, 1.7]),
  [500, 500, 0],
  [10, 1, 1],
  [4000, 900, 120],
];

/** The bounds of an extent of `sizes` whose low corner is at `at`. */
const boundsOf = (sizes: number[], at: number[]) => [
  ...at,
  ...sizes.map((size, axis) => at[axis] + size),
];

/**
 * True when a level's cube holds, on every axis, each cell the extent touches and the cells on
 * either side of it: the probes that interpolate anything in the extent, offset along a normal.
 */
function holds(level: BounceCascadeLevel, bounds: readonly number[]) {
  return [0, 1, 2].every(
    (axis) =>
      Math.floor(bounds[axis] / level.spacing) - 1 >= level.base[axis] &&
      Math.floor(bounds[3 + axis] / level.spacing) + 1 <= level.base[axis] + cascadeSize - 1,
  );
}

/** The most lattice cells of `spacing` a segment of `length` can touch, wherever it lies. */
const worstCells = (length: number, spacing: number) => Math.ceil(length / spacing - 1e-9) + 1;

test('each level doubles the spacing of the one before, and only the last stays fixed', () => {
  for (const sizes of SIZES) {
    const { levels } = createBounceCascades(boundsOf(sizes, [0, 0, 0]));
    assert.ok(levels.length >= 1 && levels.length <= cascadeLevels, `${sizes}`);
    for (let i = 1; i < levels.length; i++)
      assert.equal(levels[i].spacing, 2 * levels[i - 1].spacing);
    assert.deepEqual(
      levels.map((level) => level.moving),
      levels.map((_, i) => i < levels.length - 1),
      `${sizes}`,
    );
  }
});

test('the last level holds the whole extent wherever it lies', () => {
  for (const sizes of SIZES)
    for (const at of [
      [0, 0, 0],
      [-37.3, 5.25, -1234.5],
      [0.999, 1e4 - 0.001, -0.001],
    ]) {
      const bounds = boundsOf(sizes, at);
      const { levels } = createBounceCascades(bounds);
      assert.ok(holds(levels.at(-1)!, bounds), `${sizes} at ${at}`);
    }
});

test('a cascade stops at the first level able to hold the extent wherever it lies', () => {
  let exact = 0;
  for (const sizes of SIZES) {
    const { levels } = createBounceCascades(boundsOf(sizes, [0, 0, 0]));
    const extent = Math.max(...sizes);
    const needs = (level: BounceCascadeLevel) => worstCells(extent, level.spacing) + 2;
    if (levels.length < cascadeLevels) assert.ok(needs(levels.at(-1)!) <= cascadeSize, `${sizes}`);
    if (needs(levels.at(-1)!) === cascadeSize) exact++;
    if (levels.length > 1)
      assert.ok(needs(levels.at(-2)!) > cascadeSize, `${sizes}: one level too many`);
  }
  assert.ok(exact > 0, 'some extents fill their last level exactly');
});

test('the finest spacing keeps layers across the thinnest side under its ceiling, and no finer', () => {
  for (const sizes of SIZES) {
    const { levels } = createBounceCascades(boundsOf(sizes, [0, 0, 0]));
    const finest = levels[0].spacing,
      thinnest = Math.max(Math.min(...sizes), 1e-3);
    const limit = Math.min(cascadeSpacingMetres, thinnest / cascadeLayersAcross);
    if (finest > limit * (1 + 1e-12)) {
      // Coarser than both limits only to let a full cascade reach across the extent, just so.
      assert.equal(levels.length, cascadeLevels, `${sizes}`);
      assert.equal(
        worstCells(Math.max(...sizes), levels.at(-1)!.spacing) + 2,
        cascadeSize,
        `${sizes}`,
      );
    } else near([finest], [limit], `${sizes}`, limit * 1e-12);
  }
});

test('every plan fits the reserved probe storage, and the largest plan fills it', () => {
  let largest = 0;
  for (const sizes of SIZES) {
    const cascades = createBounceCascades(boundsOf(sizes, [0, 0, 0]));
    assert.equal(cascades.size, cascadeSize);
    assert.equal(cascades.probesPerLevel, cascadeSize ** 3);
    assert.equal(cascades.probes, cascades.probesPerLevel * cascades.levels.length);
    assert.ok(cascades.probes <= cascades.reserveCount, `${sizes}`);
    largest = Math.max(largest, cascades.probes);
  }
  assert.equal(largest, createBounceCascades([0, 0, 0, 1, 1, 1]).reserveCount);
});

test('a fixed level keeps one boundary cell before the extent on every axis, and no more', () => {
  for (const bounds of [
    [-4, 7, -2, 6, 11, 3],
    [0, 0, 0, 4000, 900, 120],
  ]) {
    const fixed = createBounceCascades(bounds).levels.at(-1)!;
    for (let axis = 0; axis < 3; axis++) {
      const second = (fixed.base[axis] + 1) * fixed.spacing;
      assert.ok(
        second <= bounds[axis] && bounds[axis] < second + fixed.spacing,
        `${bounds}: ${axis}`,
      );
    }
  }
});

test('the batch splits by the published shares, at least one probe per level', () => {
  const city = createBounceCascades([0, 0, 0, 4000, 900, 120]);
  assert.equal(city.levels.length, cascadeShares.length);
  const weight = cascadeShares.reduce((sum, share) => sum + share, 0);
  near(
    city.shareOf(1e6).map((probes) => probes / 1e6),
    cascadeShares.map((share) => share / weight),
    'shares',
    1e-6,
  );
  assert.deepEqual(
    city.shareOf(0),
    cascadeShares.map(() => 1),
    'no level starves',
  );
  for (let total = 0; total < 200; total++) {
    const shares = city.shareOf(total);
    const sum = shares.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - total) <= shares.length, `${total}: ${shares}`);
  }
  const small = createBounceCascades([0, 0, 0, 1, 1, 1]);
  assert.deepEqual(small.shareOf(12), [12], 'a single level takes the whole batch');
  const two = createBounceCascades([0, 0, 0, 20, 3, 3]);
  assert.equal(two.levels.length, 2);
  const [fine, coarse] = two.shareOf(3000);
  near(
    [fine / coarse],
    [cascadeShares[0] / cascadeShares[1]],
    'two levels share as published',
    1e-3,
  );
});

test('rays reach across the extent, wherever it lies and in proportion to its size', () => {
  const diagonal = (bounds: number[]) =>
    Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]);
  for (const bounds of [
    [0, 0, 0, 1, 1, 1],
    [-4, 7, -2, 6, 11, 3],
    [100, -200, 300, 1100, -199, 301],
  ])
    near(
      [createBounceCascades(bounds).reach],
      [diagonal(bounds) * BOUNCE_SETTINGS.rayReachFraction],
      `${bounds}`,
      1e-9,
    );
});
