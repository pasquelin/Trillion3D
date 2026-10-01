import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceCascades, type BounceCascades } from './cascades.ts';

const CITY = [0, 0, 0, 1000, 1, 1];

/** Bit `i` set when level `i` was added, removed or changed its spacing between two plans. */
function changed(before: readonly { spacing: number }[], after: readonly { spacing: number }[]) {
  let bits = 0;
  for (let i = 0; i < Math.max(before.length, after.length); i++)
    if (before[i]?.spacing !== after[i]?.spacing) bits |= 1 << i;
  return bits;
}

/** Asserts the viewpoint lies in the cell at the middle of every moving level, on every axis. */
function centred(cascades: BounceCascades, viewpoint: number[]) {
  for (const level of cascades.levels.filter((entry) => entry.moving))
    for (let axis = 0; axis < 3; axis++) {
      const first = (level.base[axis] + 0.5) * level.spacing,
        last = first + (cascades.size - 1) * level.spacing;
      const middle = (first + last) / 2;
      assert.ok(
        middle <= viewpoint[axis] && viewpoint[axis] < middle + level.spacing,
        `${viewpoint}: axis ${axis}, middle ${middle}`,
      );
    }
}

test('following the camera centres every moving level on it and leaves the fixed level', () => {
  const cascades = createBounceCascades(CITY);
  const fixed = structuredClone(cascades.levels.at(-1)!);
  for (const viewpoint of [
    [0, 0, 0],
    [-3.7, 12.5, 250],
    [999, -0.01, 0.5],
  ]) {
    cascades.follow(viewpoint);
    centred(cascades, viewpoint);
    assert.deepEqual(cascades.levels.at(-1), fixed);
  }
});

test('follow reports a move only when a level crosses a cell, on any axis', () => {
  const cascades = createBounceCascades(CITY);
  const spacing = cascades.levels[0].spacing;
  const at = [0.25 * spacing, 0.25 * spacing, 0.25 * spacing];
  assert.equal(cascades.follow(at), true, 'the first placement moves the levels');
  assert.equal(cascades.follow(at), false);
  assert.equal(cascades.follow(at.map((value) => value + 0.5 * spacing)), false, 'same cell');
  for (let axis = 0; axis < 3; axis++) {
    const next = at.slice();
    next[axis] -= 0.5 * spacing;
    assert.equal(cascades.follow(next), true, `axis ${axis}`);
    assert.equal(cascades.follow(at), true, `back on axis ${axis}`);
  }
  const single = createBounceCascades([0, 0, 0, 1, 1, 1]);
  const base = single.levels[0].base.slice();
  assert.equal(single.follow([100, 200, 300]), false, 'a lone fixed level never follows');
  assert.deepEqual(single.levels[0].base, base);
});

test('whole-scene translation changes cell stamps without discarding the existing lattice', () => {
  const cascades = createBounceCascades(CITY);
  cascades.follow([3, 0, 0]);
  const before = structuredClone(cascades.levels);
  const moved = [100, 200, 300, 1100, 201, 301];
  assert.equal(cascades.replan(moved), false);
  assert.equal(cascades.invalidLevels, 0);
  const fresh = createBounceCascades(moved);
  assert.deepEqual(cascades.levels.slice(0, -1), before.slice(0, -1), 'moving levels stay');
  assert.deepEqual(cascades.levels.at(-1), fresh.levels.at(-1), 'the fixed level is placed anew');
  assert.notDeepEqual(cascades.levels.at(-1)!.base, before.at(-1)!.base);
  assert.equal(cascades.reach, fresh.reach);
});

test('a replan places every level whose role or lattice changed as a fresh plan would', () => {
  const pairs = [
    [CITY, [0, 0, 0, 2000, 1, 1]],
    [CITY, [-1, -2, -3, 0, -1, -2]],
    [[0, 0, 0, 1, 1, 1], CITY],
    // One fixed level of a 20 m cube turns into the moving first level of a longer scene.
    [
      [0, 0, 0, 20, 20, 20],
      [5, 5, 5, 45, 25, 25],
    ],
    [
      [5, 5, 5, 45, 25, 25],
      [0, 0, 0, 20, 20, 20],
    ],
  ];
  for (const [from, to] of pairs) {
    const cascades = createBounceCascades(from);
    cascades.follow([7, 7, 7]);
    const before = structuredClone(cascades.levels);
    const bits = changed(before, createBounceCascades(to).levels);
    assert.equal(cascades.replan(to), bits !== 0, `${from} to ${to}`);
    assert.equal(cascades.invalidLevels, bits, `${from} to ${to}`);
    const fresh = createBounceCascades(to);
    assert.equal(cascades.reach, fresh.reach);
    assert.equal(cascades.probes, fresh.probes);
    assert.deepEqual(cascades.shareOf(1000), fresh.shareOf(1000));
    cascades.levels.forEach((level, i) => {
      const kept = before[i]?.moving && level.moving && before[i].spacing === level.spacing;
      assert.deepEqual(
        level,
        kept ? { ...fresh.levels[i], base: before[i].base } : fresh.levels[i],
      );
    });
    assert.equal(cascades.replan(to), false, 'replanning the same extent changes nothing');
    assert.equal(cascades.invalidLevels, 0);
  }
});

test('enlarged geometry uses the same bounded cascade plan as preparing that extent', () => {
  const cascades = createBounceCascades([0, 0, 0, 1, 1, 1]);
  const fresh = createBounceCascades(CITY);
  assert.equal(cascades.replan(CITY), true);
  assert.equal(cascades.invalidLevels, changed([{ spacing: NaN }], fresh.levels), 'every level');
  assert.deepEqual(cascades.levels, fresh.levels);
  assert.equal(cascades.probes, cascades.reserveCount);
  assert.equal(cascades.reserveCount, fresh.reserveCount, 'the reserve never grows');
});
