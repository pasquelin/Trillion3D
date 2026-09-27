import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTilePageTable, PAGE_HEADER_WORDS } from './pageTable.ts';
import { regrownPageTable } from './regrow.ts';
import { packEntry, tileLayout } from '../../texture/tiles.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

// #847: a texture appended after open lays the table out again around what it held — each header,
// each entry — at its feedback offset, in a buffer of its new size sent whole; the old destroyed.
test('a table regrown for an appended texture keeps every held word, at its new ranks', () => {
  const { device, writes, destroyed } = fakeDevice();
  const layouts = [tileLayout(1, 1), tileLayout(2048, 1024), tileLayout(512, 512)];
  const old = createWebgpuTilePageTable(device, layouts, { kind: 'color', feedbackOffset: 7 });
  const tile = { slot: 2, level: 1, tx: 1, ty: 0 },
    place = { x: 3, y: 4, layer: 0 };
  old.setTile(tile, place);
  old.setTail(1, { x: 1, y: 2, layer: 0 }, 1);
  old.flush(device);
  const headers = old.words.slice(PAGE_HEADER_WORDS, old.words[3]);
  layouts.push(tileLayout(256, 256));
  const table = regrownPageTable(device, old, layouts, { kind: 'color', feedbackOffset: 9 });
  assert.ok(destroyed.includes(old.buffer as never), 'the old buffer destroyed');
  assert.equal(table.buffer.size, table.words.byteLength);
  const last = writes.at(-1)!;
  assert.deepEqual([last.offset, last.size ?? table.words.length], [0, table.words.length]);
  assert.deepEqual(
    table.words.slice(PAGE_HEADER_WORDS, PAGE_HEADER_WORDS + headers.length),
    headers,
  );
  assert.deepEqual([table.words[0], table.words[1]], [9, 4]);
  assert.equal(table.entryOf(tile), packEntry(place, 1), 'a resident tile is still served');
  assert.equal(table.entryOf({ slot: 2, level: 0, tx: 2, ty: 0 }), packEntry(place, 1));
  assert.equal(table.entries, 171 + 21 + 5, 'the 256² texture: 2×2 + 1 entries');
  const fresh = { slot: 3, level: 1, tx: 0, ty: 0 };
  assert.equal(table.entryOf(fresh), 0, 'nothing streamed yet: its tail');
  assert.equal(table.feedbackIndexOf(fresh), 9 + 192 + 4);
  assert.deepEqual(table.tileOf(9 + 192 + 4), fresh);
  assert.equal(table.feedbackIndexOf(tile), 9 + 171 + 16 + 1, 'a held tile at its new rank');
});
