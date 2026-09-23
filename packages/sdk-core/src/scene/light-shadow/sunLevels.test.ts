// A sun's clipmap: extents centred on the camera by whole pages, a depth range that spans the
// scene and does not move with a small growth, and requests read back with the extents of the
// frame that wrote them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSunLevels } from './sunLevels.ts';
import { SUN_WINDOW, sunEntry } from './virtual.ts';
import { VIEW } from './lightShadow.fixture.ts';

const AXIS = [0, -1, 0];
const at = (x: number) => ({ ...VIEW, position: [x, 5, 0] as [number, number, number] });

test('a request is read with the extents of the frame that wrote it, after the camera moved', () => {
  const sun = createSunLevels();
  sun.update(0, AXIS, at(0), [-10, 0, -10], [10, 5, 10], 1);
  const level = sun.finest[0] + 3,
    page = 128 * 2 ** level;
  const ox = sun.origins[(((level % 16) + 16) % 16) * 2];
  // A page at the far edge of frame 1's extent, asked for by frame 1.
  const ax = ox + SUN_WINDOW - 1,
    entry = sunEntry(level, ax, 0);
  // Frame 2: the camera moved by half an extent along `right` — the absolute page is the same.
  sun.update(0, AXIS, at((SUN_WINDOW / 2) * page), [-10, 0, -10], [10, 5, 10], 2);
  const out = new Int32Array(3);
  assert.equal(sun.decode(0, entry, 1, out), true);
  assert.deepEqual([...out], [level, ax, 0]);
  assert.equal(sun.decode(0, entry, 9, out), false, 'a frame whose layout is gone reads nothing');
});

test("a page leaves the clipmap once the camera's extent no longer covers it", () => {
  const sun = createSunLevels();
  sun.update(0, AXIS, at(0), [-10, 0, -10], [10, 5, 10], 1);
  const level = sun.finest[0] + 2,
    ox = sun.origins[(((level % 16) + 16) % 16) * 2];
  assert.equal(sun.holds(0, level, ox, 0) || sun.holds(0, level, ox, -1), true);
  assert.equal(sun.holds(0, level, ox - 1, 0), false);
  assert.equal(sun.holds(0, sun.finest[0] - 1, ox, 0), false, 'finer than the finest level');
});

test('the depth range spans the scene box along the axis, and a small growth keeps it', () => {
  const sun = createSunLevels();
  assert.equal(sun.update(0, AXIS, at(0), [-10, 0, -10], [10, 5, 10], 1), true, 'first frame');
  const range = [...sun.depth.subarray(0, 2)];
  assert.ok(range[0] <= -5 && range[1] >= 0, `the scene lies in [${range}]`);
  assert.equal(sun.update(0, AXIS, at(0), [-10, 0, -10], [10, 5.1, 10], 2), false);
  assert.deepEqual([...sun.depth.subarray(0, 2)], range);
});

test('a step smaller than a page moves no window; a step of one finest page moves that level', () => {
  const sun = createSunLevels();
  sun.update(0, AXIS, at(0), [-10, 0, -10], [10, 5, 10], 1);
  const finest = sun.finest[0],
    page = 128 * 2 ** finest;
  // Away from any page edge of any level, then a quarter of a finest page further.
  sun.update(0, AXIS, at(page / 2), [-10, 0, -10], [10, 5, 10], 2);
  sun.update(0, AXIS, at((3 * page) / 4), [-10, 0, -10], [10, 5, 10], 3);
  const movedNow = () => Array.from({ length: 16 }, (_, k) => sun.movedLevel(0, finest + k));
  assert.equal(movedNow().some(Boolean), false);
  sun.update(0, AXIS, at((3 * page) / 4 + page), [-10, 0, -10], [10, 5, 10], 4);
  assert.equal(movedNow()[0], true);
  assert.equal(movedNow()[15], false, 'the coarsest window holds');
});
