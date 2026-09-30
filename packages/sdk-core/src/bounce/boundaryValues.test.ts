import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades } from './cascades.ts';
import { createBounceOccupancy } from './occupancy.ts';
import { BOUNCE_PROBES_PER_FRAME, BOUNCE_SETTINGS } from './contracts.ts';
import { bounceBatchOf } from './budget.ts';
import { ownedProxy } from '../scene/core/proxy.fixture.ts';

test('a full bounce batch makes progress across a grid and respects the ray ceiling', () => {
  const probes = bounceBatchOf(BOUNCE_PROBES_PER_FRAME, 1);
  assert.ok(probes >= 16, 'a frame can refresh at least one grid row');
  assert.ok(probes * BOUNCE_SETTINGS.raysPerProbe <= BOUNCE_SETTINGS.raysPerFrame);
});

test('cascade resolution preserves thin geometry and avoids a redundant level at exact coverage', () => {
  const thin = createBounceCascades([0, 0, 0, 10, 1, 1]);
  assert.ok(thin.levels[0].spacing <= 1 / 3);
  const city = createBounceCascades([0, 0, 0, 1040, 100, 100]);
  const last = city.levels.at(-1)!;
  assert.ok((last.base[0] + city.size - 1.5) * last.spacing >= 1040);
  for (let i = 1; i < city.levels.length; i++)
    assert.equal(city.levels[i].spacing / city.levels[i - 1].spacing, 2);
  const exact = createBounceCascades([0, 0, 0, 26, 26, 26]);
  assert.equal(exact.levels.length, 1);
});

test('motion at map edges cannot wrap occupied cells into other rows or planes', () => {
  for (const point of [
    [-2, 5, 5],
    [11, 5, 5],
    [5, -2, 5],
    [5, 11, 5],
    [5, 5, -2],
    [5, 5, 11],
  ]) {
    const proxy = ownedProxy();
    proxy.bounds = [0, 0, 0, 8, 8, 8];
    proxy.data.triangles = new Float32Array();
    const cascades = createBounceCascades(proxy.bounds);
    cascades.levels = [
      { spacing: 1, base: [0, 0, 0], moving: false },
      { spacing: 2, base: [0, 0, 0], moving: false },
    ];
    const occupancy = createBounceOccupancy(proxy, cascades);
    occupancy.moved([...point, ...point], [1]);
    assert.equal(occupancy.marked, 18);
    for (let z = -4; z <= 13; z++)
      for (let y = -4; y <= 13; y++)
        for (let x = -4; x <= 13; x++) {
          const inside = [x, y, z].every((value) => value >= -2 && value <= 11);
          const near = [x, y, z].every((value, axis) => Math.abs(value - point[axis]) <= 1);
          assert.equal(occupancy.occupied(0, x, y, z), inside && near, `${point}: ${x},${y},${z}`);
        }
  }
});

test('coarse occupancy preserves a raised triangle without flattening its height', () => {
  const proxy = ownedProxy();
  proxy.bounds = [0, 0, 0, 8, 8, 8];
  proxy.data.triangles = new Float32Array([6, 6, 6, 7, 6, 6, 6, 7, 6]);
  const cascades = createBounceCascades(proxy.bounds);
  cascades.levels = [
    { spacing: 1, base: [0, 0, 0], moving: false },
    { spacing: 2, base: [0, 0, 0], moving: false },
  ];
  const occupancy = createBounceOccupancy(proxy, cascades);
  assert.equal(occupancy.occupied(1, 3, 3, 3), true);
  assert.equal(occupancy.occupied(1, 3, 3, 0), false);
  for (const point of [
    [-3, 5, 5],
    [12, 5, 5],
    [5, -3, 5],
    [5, 12, 5],
    [5, 5, -3],
    [5, 5, 12],
  ]) {
    const next = createBounceOccupancy(proxy, cascades);
    next.moved([...point, ...point], [1]);
    assert.equal(next.occupied(0, 100, 100, 100), true);
  }
});

test('small continuous extent changes never allocate beyond reserved probe storage', () => {
  for (let width = 100; width < 110; width += 0.1) {
    const cascades = createBounceCascades([0, 0, 0, width, 1, 1]);
    assert.ok(cascades.probes <= cascades.reserveCount, `width ${width}`);
  }
});

test('four occupancy levels keep a corner triangle confined to its interpolation region', () => {
  const proxy = ownedProxy();
  proxy.bounds = [0, 0, 0, 64, 64, 64];
  const cascades = createBounceCascades(proxy.bounds);
  cascades.levels = [1, 2, 4, 8].map((spacing) => ({ spacing, base: [0, 0, 0], moving: false }));
  const occupancy = createBounceOccupancy(proxy, cascades);
  for (let level = 0; level < 4; level++)
    for (let z = -4; z < 10; z++)
      for (let y = -4; y < 10; y++)
        for (let x = -4; x < 10; x++) {
          const low = level === 1 || level === 2 ? -2 : -1;
          const expected = x >= low && x <= 2 && y >= low && y <= 2 && z >= low && z <= 1;
          assert.equal(occupancy.occupied(level, x, y, z), expected, `${level}: ${x},${y},${z}`);
        }
});
