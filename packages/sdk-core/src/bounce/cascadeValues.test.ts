import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades } from './cascades.ts';

test('cascade shares keep every level progressing and follow updates every mobile axis', () => {
  const value = createBounceCascades([0, 0, 0, 1000, 1, 1]);
  assert.equal(value.size, 16);
  assert.equal(value.probesPerLevel, 4096);
  assert.equal(value.probes, 16384);
  assert.deepEqual(value.shareOf(15), [8, 4, 2, 1]);
  assert.deepEqual(value.shareOf(0), [1, 1, 1, 1]);
  assert.deepEqual(
    value.levels.map((level) => level.moving),
    [true, true, true, false],
  );
  const fixed = structuredClone(value.levels[3]);
  assert.equal(value.follow([0, 0, 0]), true);
  assert.deepEqual(value.levels[0].base, [-8, -8, -8]);
  assert.equal(value.follow([0, 0, 0]), false);
  const spacing = value.levels[0].spacing;
  assert.equal(value.follow([-spacing / 2, spacing, 2 * spacing]), true);
  assert.deepEqual(value.levels[0].base, [-9, -7, -6]);
  assert.deepEqual(value.levels[3], fixed);
  const bases = value.levels.slice(0, 3).map((level) => level.base);
  assert.equal(value.replan([100, 200, 300, 1100, 201, 301]), false);
  assert.deepEqual(
    value.levels.slice(0, 3).map((level) => level.base),
    bases,
  );
  assert.notDeepEqual(value.levels[3].base, fixed.base);
});

test('shrinking a scene invalidates removed levels and restores a fixed single grid', () => {
  const value = createBounceCascades([0, 0, 0, 1000, 1, 1]);
  assert.equal(value.replan([-1, -2, -3, 0, -1, -2]), true);
  assert.equal(value.invalidLevels, 15);
  assert.equal(value.levels.length, 1);
  assert.equal(value.levels[0].moving, false);
  assert.equal(value.probes, 4096);
  assert.equal(value.reserveCount, 16384);
  assert.deepEqual(value.shareOf(12), [12]);
  assert.equal(value.follow([100, 200, 300]), false);
  assert.equal(value.replan([-1, -2, -3, 0, -1, -2]), false);
  assert.equal(value.invalidLevels, 0);
  assert.ok(Math.abs(value.reach - Math.sqrt(3)) < 1e-12);
});

test('translated noncubic extents keep diagonal reach and grids covering both ends', () => {
  const value = createBounceCascades([-4, 7, -2, 6, 11, 3]);
  assert.ok(Math.abs(value.reach - Math.sqrt(141)) < 1e-10);
  for (const level of value.levels) {
    for (let axis = 0; axis < 3; axis++)
      assert.ok((level.base[axis] + 0.5) * level.spacing < [-4, 7, -2][axis]);
  }
  assert.equal(value.shareOf(0).length, value.levels.length);
  const fixed = value.levels.at(-1)!;
  for (let axis = 0; axis < 3; axis++)
    assert.ok((fixed.base[axis] + 15.5) * fixed.spacing > [6, 11, 3][axis]);
  value.replan([4, -7, 2, 14, -3, 7]);
  assert.ok(Math.abs(value.reach - Math.sqrt(141)) < 1e-10);
  const moving = createBounceCascades([0, 0, 0, 1000, 1, 1]);
  moving.follow([0, 0, 0]);
  assert.equal(moving.follow([moving.levels[0].spacing, 0, 0]), true);
  moving.replan([0, 0, 0, 2000, 1, 1]);
  assert.deepEqual(moving.levels, createBounceCascades([0, 0, 0, 2000, 1, 1]).levels);
});
