// The virtual layout both the scheduler and the shaders address pages by: a lamp entry names its
// face, mip and page back, and a sun entry is the same word for every extent a page is seen in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAMP_FACE_ENTRIES,
  LAMP_MIPS,
  POOL_PAGES,
  SUN_ENTRIES,
  SUN_LEVELS,
  SUN_WINDOW,
  decodeLampEntry,
  finestSunLevel,
  lampEntry,
  lampPagesAt,
  sunEntry,
  tableEntriesOf,
} from './virtual.ts';
import { LIGHT_KIND } from '../light/contracts.ts';

test('a lamp entry decodes to the face, mip and page it was built from, every entry once', () => {
  const out = new Int32Array(4),
    seen = new Set<number>();
  for (let face = 0; face < 6; face++)
    for (let mip = 0; mip < LAMP_MIPS; mip++)
      for (let y = 0; y < lampPagesAt(mip); y++)
        for (let x = 0; x < lampPagesAt(mip); x++) {
          const entry = lampEntry(face, mip, x, y);
          seen.add(entry);
          assert.deepEqual([...decodeLampEntry(entry, out)], [face, mip, x, y]);
        }
  assert.equal(seen.size, 6 * LAMP_FACE_ENTRIES);
  assert.equal(tableEntriesOf(LIGHT_KIND.point), 6 * LAMP_FACE_ENTRIES);
  assert.equal(tableEntriesOf(LIGHT_KIND.spot), LAMP_FACE_ENTRIES);
  assert.equal(lampPagesAt(0) ** 2, POOL_PAGES, 'the finest mip of a face is the pool');
});

test('a sun page keeps its entry whichever extent sees it: absolute page modulo the extent', () => {
  assert.equal(sunEntry(-7, 3, -2), sunEntry(-7, 3 + SUN_WINDOW, -2 - 2 * SUN_WINDOW));
  assert.equal(sunEntry(-7, 3, -2), sunEntry(-7 + SUN_LEVELS, 3, -2), 'levels ring too');
  assert.notEqual(sunEntry(-7, 3, -2), sunEntry(-6, 3, -2));
  assert.ok(sunEntry(-7, 3, -2) < SUN_ENTRIES);
  assert.equal(tableEntriesOf(LIGHT_KIND.directional), SUN_ENTRIES);
});

test("the finest sun level is the one whose texel is at most the pixel's near footprint", () => {
  assert.equal(finestSunLevel(1), 0);
  assert.equal(finestSunLevel(0.99), -1);
  assert.equal(finestSunLevel(2 ** -10), -10);
});
