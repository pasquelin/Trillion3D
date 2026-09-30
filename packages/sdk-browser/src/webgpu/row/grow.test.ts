// #216: the row table grows in place. Its visibility rows keep their ranks and words; the blended
// casters' rows move behind the new visibility rows, and the light cull's map hears where.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowSync } from './sync.ts';
import { createWebgpuRowCommit } from './commit.ts';
import { ROW_FLAGS_WORD } from './pageRow.ts';
import { FLAG_BLEND_CASTER } from '../../visibility/buffer.ts';
import { catalogue, mount, STRIDE } from './blendCasters.fixture.ts';

test('caster rows follow blendFirst after a grow, and the visibility rows keep their ranks', () => {
  const pages = catalogue(0.4);
  const { rows, writer, map, pins } = mount(pages, 1);
  const sync = createWebgpuRowSync(
    rows,
    { sync: () => {}, dirty: true },
    pages,
    { drawn: [], drawnPacked: [] },
    () => true,
    createWebgpuRowCommit(rows, writer),
  );
  const casters = sync.blendCasters;
  sync.syncRows();
  casters.pin(map);
  // One visibility row, the opaque triangle's; the blended one casts from the row behind it.
  assert.deepEqual([rows.rowOfPage[0], rows.blendRowOf[1], rows.blendFirst], [0, 1, 1]);
  const opaqueWords = Array.from(rows.pageTableInts!.subarray(0, STRIDE));
  rows.grow(3, 2);
  rows.clearDirty();
  sync.syncRows();
  assert.deepEqual([rows.blendFirst, rows.casterSlots, rows.generation], [3, 5, 1]);
  assert.equal(rows.rowOfPage[0], 0, 'the opaque page keeps its rank');
  assert.deepEqual(Array.from(rows.pageTableInts!.subarray(0, STRIDE)), opaqueWords);
  assert.equal(rows.packedRecs[0], pages[0]);
  assert.equal(rows.blendRowOf[1], 3, 'the first caster row behind the new visibility rows');
  assert.equal(rows.packedRecs[3], pages[1]);
  assert.equal(rows.packedRecs[1], undefined, 'its old row is a free visibility row now');
  assert.ok(rows.pageTableInts![3 * STRIDE + ROW_FLAGS_WORD] & FLAG_BLEND_CASTER);
  assert.equal(rows.dirtyMarks[3], 1, 'the caster row is uploaded again');
  casters.pin(map);
  assert.deepEqual(pins, [
    [1, 1],
    [1, 3],
  ]);
  assert.equal(casters.used, 1);
});

test('a grown table marks every row dirty, and the rows past the old table are empty', () => {
  const pages = catalogue(0.4, false);
  const { rows } = mount(pages, 0);
  rows.clearDirty();
  rows.grow(4, 0);
  assert.equal(rows.dirtyFrom, 0);
  assert.equal(rows.dirtyTo, 3);
  assert.deepEqual(Array.from(rows.rowPageIndex), [-1, -1, -1, -1]);
  assert.equal(rows.pageTableFloats!.length, 4 * STRIDE);
  assert.equal(rows.packedRecs.length, 4);
});
