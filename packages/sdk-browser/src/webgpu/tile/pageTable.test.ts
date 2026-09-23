import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTilePageTable, PAGE_HEADER_WORDS } from './pageTable.ts';
import { entryLevel, entryPlace, MAX_LEVELS, packEntry, tileLayout } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

installGpuGlobals();

/** A dummy device: it journals every buffer write, in words. */
function fakeDevice() {
  const writes: Array<[number, number]> = [];
  const device = {
    createBuffer: () => ({ destroy: () => {} }) as unknown as GPUBuffer,
    queue: {
      writeBuffer: (_b: GPUBuffer, offset: number, _d: unknown, from?: number, size?: number) =>
        writes.push([offset / 4, size ?? -1]),
    },
  } as unknown as Pick<GPUDevice, 'createBuffer' | 'queue'>;
  return { device, writes };
}

const layouts = () => [tileLayout(1, 1), tileLayout(2048, 1024), tileLayout(512, 512)];

test('the table lays out headers, levels and entries, and finds a tile from its feedback rank', () => {
  const { device } = fakeDevice();
  const table = createWebgpuTilePageTable(device, layouts(), {
    kind: 'color',
    feedbackOffset: 1000,
  });
  // 2048×1024: 16×8 + 8×4 + 4×2 + 2×1 + 1×1 = 171 entries; 512²: 4×4 + 2×2 + 1 = 21.
  assert.equal(table.entries, 171 + 21);
  const w = table.words;
  assert.equal(w[0], 1000);
  assert.equal(w[1], 3);
  assert.equal(w[3], PAGE_HEADER_WORDS + 3 * 4);
  assert.equal(w[2], w[3] + 3 * MAX_LEVELS);
  assert.equal(w[PAGE_HEADER_WORDS + 4], 2048 | (1024 << 16));
  assert.equal(w[PAGE_HEADER_WORDS + 5], 5, 'queue of 2048×1024: level 5, 64×32');
  assert.equal(w[PAGE_HEADER_WORDS + 6], 11);
  assert.equal(w[w[3] + 1 * MAX_LEVELS + 1], w[2] + 128, 'level 1 of texture 1, absolute');
  const key = { slot: 2, level: 1, tx: 1, ty: 1 };
  assert.equal(table.feedbackIndexOf(key), 1000 + 171 + 16 + 3);
  assert.deepEqual(table.tileOf(1000 + 171 + 16 + 3), key);
  assert.deepEqual(table.tileOf(1000 + 170), { slot: 1, level: 4, tx: 0, ty: 0 });
  assert.throws(() => table.tileOf(999), /TEXTURE_FEEDBACK_INDEX/);
  assert.throws(() => table.entryOf({ slot: 2, level: 3, tx: 0, ty: 0 }), /TEXTURE_TILE_IN_TAIL/);
  assert.throws(
    () => table.entryOf({ slot: 2, level: 0, tx: 4, ty: 0 }),
    /TEXTURE_TILE_OUT_OF_LEVEL/,
  );
});

test('an arriving tile serves still-finer entries with no tile; a finer one does not yield them', () => {
  const { device } = fakeDevice();
  const table = createWebgpuTilePageTable(device, layouts(), { kind: 'color', feedbackOffset: 0 });
  const at = (level: number, tx: number, ty: number) => table.entryOf({ slot: 2, level, tx, ty });
  const fine = { x: 3, y: 0, layer: 0 },
    coarse = { x: 9, y: 9, layer: 1 };
  table.setTile({ slot: 2, level: 0, tx: 1, ty: 0 }, fine);
  table.setTile({ slot: 2, level: 2, tx: 0, ty: 0 }, coarse);
  assert.equal(at(2, 0, 0), packEntry(coarse, 2));
  assert.equal(at(1, 1, 1), packEntry(coarse, 2), 'served by the coarse one, level 2');
  assert.equal(at(0, 0, 0), packEntry(coarse, 2));
  assert.equal(at(0, 1, 0), packEntry(fine, 0), 'the fine one keeps its place');
  // A level-1 tile arrives: it takes its descendants from the coarse one, not from the fine one.
  const middle = { x: 5, y: 5, layer: 0 };
  table.setTile({ slot: 2, level: 1, tx: 0, ty: 0 }, middle);
  assert.equal(at(0, 0, 0), packEntry(middle, 1));
  assert.equal(at(0, 1, 0), packEntry(fine, 0));
  assert.equal(at(0, 2, 0), packEntry(coarse, 2), 'outside the quarter of the level-1 tile');
});

test('a leaving tile gives its entries back to the finest resident ancestor, or to the queue', () => {
  const { device, writes } = fakeDevice();
  const table = createWebgpuTilePageTable(device, layouts(), { kind: 'data', feedbackOffset: 0 });
  const at = (level: number, tx: number, ty: number) => table.entryOf({ slot: 2, level, tx, ty });
  const coarse = { x: 1, y: 1, layer: 0 },
    middle = { x: 2, y: 2, layer: 0 };
  table.setTile({ slot: 2, level: 2, tx: 0, ty: 0 }, coarse);
  table.setTile({ slot: 2, level: 1, tx: 1, ty: 1 }, middle);
  table.flush(device);
  assert.equal(at(0, 3, 3), packEntry(middle, 1));
  table.clearTile({ slot: 2, level: 1, tx: 1, ty: 1 });
  assert.equal(at(1, 1, 1), packEntry(coarse, 2));
  assert.equal(at(0, 3, 3), packEntry(coarse, 2));
  table.clearTile({ slot: 2, level: 2, tx: 0, ty: 0 });
  assert.equal(at(2, 0, 0), 0, 'nothing streamed any more: the queue');
  assert.equal(at(0, 0, 0), 0);
  writes.length = 0;
  table.flush(device);
  assert.equal(writes.length, 1, 'one write per touched texture');
  const [from, size] = writes[0];
  assert.equal(from, table.words[2] + 171, 'from the first entry of texture 2');
  assert.equal(size, 21);
  table.flush(device);
  assert.equal(writes.length, 1, 'nothing to send when nothing has moved');
});

test("a texture's queue is posted in its header with its lane, and sent alone", () => {
  const { device, writes } = fakeDevice();
  const table = createWebgpuTilePageTable(device, layouts(), { kind: 'color', feedbackOffset: 0 });
  writes.length = 0;
  table.setTail(1, { x: 4, y: 2, layer: 1 }, 2);
  table.flush(device);
  assert.deepEqual(writes, [[PAGE_HEADER_WORDS + 4 + 3, 1]]);
  assert.equal(table.words[PAGE_HEADER_WORDS + 7], 4 | (2 << 8) | (1 << 16) | (2 << 24));
  const word = packEntry({ x: 4, y: 2, layer: 1 }, 3);
  assert.equal(entryLevel(word), 3);
  assert.deepEqual(entryPlace(word), { x: 4, y: 2, layer: 1 });
});
