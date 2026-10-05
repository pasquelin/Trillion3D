// The read of a blended surface and of the water (`vsmShadowRead`, `shadowWgsl.ts`): the shipped
// WGSL run in JavaScript (`shaderRun`), the virtual shadow map under it a small page table and pool
// the tests describe. Mode 0 is the point read as it stood; mode 1 sixteen taps a texel apart over
// the 4 × 4 texels around the sample; mode 2 the traced rays. Taps and neighbour pages here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PCF_TAPS } from './pcfTaps.ts';
import { type V, PAGE, MAP, mapped, coarser, World, TAPS, run } from './vsmFilteredRead.fixture.ts';
import {
  FILTER,
  type Filter,
  sample,
  pagedSample,
  REQUESTED,
  FLAT,
  developCoverage,
  pagedWorld,
  POSITIONS,
} from './vsmFilteredSample.fixture.ts';

test('the shipped taps are the PCF table: within a texel of the read point, and its quarter turns', () => {
  assert.deepEqual(TAPS, PCF_TAPS);
  for (const [x, y] of TAPS) {
    assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1);
    assert.ok(TAPS.some(([u, v]) => u === -y && v === x));
  }
});

test('a receiver at one depth over a level of one depth reads exactly 0 or 1', () => {
  for (const above of [true, false]) {
    const world = pagedWorld(() => 0.5);
    const f = run<Filter>(world, FILTER);
    for (const p of POSITIONS) {
      f.testReset();
      // Reversed depth: a receiver above the level is nearer the light, its depth the larger.
      const lit = f.vsmFilterTaps(REQUESTED, pagedSample(p), above ? 0.6 : 0.4, FLAT, true);
      assert.equal(lit, above ? 1 : 0, `${p} ${above}`);
      assert.deepEqual(f.testTransmission(), [1, 1, 1]);
    }
  }
});

test("a straight edge gives develop's tap coverage, across pages too", () => {
  for (const edge of [
    (t: V) => t[0] >= 768,
    (t: V) => t[1] >= 1024,
    (t: V) => t[0] + 0.37 * t[1] >= 1100.2,
    (t: V) => t[0] - t[1] >= 0.5,
  ]) {
    const world = pagedWorld((t) => (edge(t) ? 0.4 : 0.6));
    const f = run<Filter>(world, FILTER);
    for (const p of [...POSITIONS, [766.9, 700.2], [769.1, 1023.2], [700.3, 698.8]]) {
      const lit = f.vsmFilterTaps(REQUESTED, pagedSample(p), 0.5, FLAT, true);
      const want = developCoverage(p, edge);
      assert.ok(Math.abs(lit - want) < 1e-12, `${p}: ${lit} against ${want}`);
    }
  }
});

test('a tap off the sample’s page reads the neighbouring page, translated once', () => {
  // Page 5 lit, page 6 (one to the right) in shadow, each at its own physical page.
  const world = new World();
  world.set(MAP, 0, [5, 7], mapped([20, 2]));
  world.set(MAP, 0, [6, 7], mapped([9, 11]));
  world.depth = (physical) => (Math.floor(physical[0] / PAGE) === 9 ? 0.6 : 0.4);
  const f = run<Filter>(world, FILTER);
  const p = [6 * PAGE - 0.7, 7 * PAGE + 40.3];
  const sm = sample(p, [20, 2]);
  const lit = f.vsmFilterTaps(REQUESTED, sm, 0.5, FLAT, true);
  assert.ok(Math.abs(lit - developCoverage(p, (t) => t[0] < 6 * PAGE)) < 1e-12, `${lit}`);
  assert.ok(lit > 0.2 && lit < 0.9);
  assert.deepEqual(world.lookups, [`${MAP}:0:6,7`], 'one translation, of the neighbour alone');
  // Away from any edge, no page is translated.
  world.lookups = [];
  f.vsmFilterTaps(REQUESTED, sample([5 * PAGE + 64.2, 7 * PAGE + 64.8], [20, 2]), 0.5, FLAT, true);
  assert.deepEqual(world.lookups, []);
});

test('a neighbour page only a coarser level holds is read there; one nothing holds lights', () => {
  const p = [6 * PAGE - 0.7, 7 * PAGE + 40.3];
  const coverageRight = developCoverage(p, (t) => t[0] < 6 * PAGE);
  // The neighbour's entry points one level up; that level's page is mapped, its depth on its own
  // scale: d_coarse = d·scale + bias.z, so 0.6 on the requested scale is 0.3 + 0.01.
  for (const [stored, want] of [
    [0.31, coverageRight],
    [0.24, 1],
  ]) {
    const world = new World();
    world.set(MAP, 0, [5, 7], mapped([20, 2]));
    world.set(MAP, 0, [6, 7], coarser(1));
    const coarsePage = world.coarsePage([6, 7], 1);
    world.set(MAP + 1, 0, coarsePage, mapped([30, 3]));
    world.depth = (physical) => (Math.floor(physical[0] / PAGE) === 30 ? stored : 0.4);
    const f = run<Filter>(world, FILTER);
    const lit = f.vsmFilterTaps(REQUESTED, sample(p, [20, 2]), 0.5, FLAT, true);
    assert.ok(Math.abs(lit - want) < 1e-12, `${stored}: ${lit} against ${want}`);
    assert.deepEqual(world.lookups, [`${MAP}:0:6,7`, `${MAP + 1}:0:${coarsePage}`]);
  }
  const world = new World();
  world.set(MAP, 0, [5, 7], mapped([20, 2]));
  world.depth = () => 0.6;
  const f = run<Filter>(world, FILTER);
  const lit = f.vsmFilterTaps(REQUESTED, sample(p, [20, 2]), 0.5, FLAT, true);
  assert.ok(Math.abs(lit - (1 - coverageRight)) < 1e-12, 'the unmapped page’s texels light');
});

test("a lamp's neighbour page held by a coarser mip reads that mip's texel", () => {
  // Mip 2 of a spot: the neighbour's entry holds mip 3's page, its texels half as fine.
  const world = new World();
  world.set(MAP, 2, [9, 4], mapped([1, 1]));
  world.set(MAP, 2, [10, 4], coarser(1, [7, 7]));
  const reads: V[] = [];
  world.depth = (physical) => {
    if (Math.floor(physical[0] / PAGE) === 7) reads.push(physical.map((t) => t - 7 * PAGE));
    return Math.floor(physical[0] / PAGE) === 7 ? 0.6 : 0.4;
  };
  const f = run<Filter>(world, FILTER);
  const p = [10 * PAGE - 0.3, 4 * PAGE + 70.6];
  const lit = f.vsmFilterTaps(REQUESTED, sample(p, [1, 1], 2), 0.5, FLAT, false);
  assert.ok(Math.abs(lit - developCoverage(p, (t) => t[0] < 10 * PAGE)) < 1e-12, `${lit}`);
  // Texels 1280..1281 of mip 2 fall in texel 640 of mip 3, page 5's first: local 0.
  for (const [x, y] of reads) {
    assert.equal(x, 0);
    assert.ok(y >= 34 && y <= 36, `${y}`);
  }
});
