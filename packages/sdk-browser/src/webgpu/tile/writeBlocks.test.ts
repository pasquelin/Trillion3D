import test from 'node:test';
import assert from 'node:assert/strict';
import { writeTailFromBlocks, writeTileFromBlocks } from './writeBlocks.ts';
import { tileRegion } from './write.ts';
import { tailOffset, TILE_BORDER, TILE_PITCH } from '../../texture/tiles.ts';

type Write = { origin: GPUOrigin3D; layout: GPUTexelCopyBufferLayout; size: GPUExtent3D };
function fakeQueue() {
  const writes: Write[] = [];
  const queue = {
    writeTexture: (
      destination: { origin?: GPUOrigin3D },
      _data: unknown,
      layout: GPUTexelCopyBufferLayout,
      size: GPUExtent3D,
    ) => writes.push({ origin: destination.origin!, layout, size }),
  } as unknown as GPUQueue;
  return { queue, writes };
}
const pool = {} as GPUTexture;
const level = (width: number, height: number) =>
  new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 16);

// Behaviour: a tile at the edge of a 130-texel level is 6 texels wide; WebGPU copies whole
// blocks, so the write is 8 texels wide, read at the block row the region starts on, and never
// beyond the level's padded blocks.
test('a tile region is written in whole blocks, from the block row and column it starts on', () => {
  const { queue, writes } = fakeQueue();
  const source = level(130, 130);
  const region = tileRegion(130, 130, 1, 0);
  assert.deepEqual([region.sx, region.width, region.dx], [124, 6, 0]);
  writeTileFromBlocks(queue, pool, { x: 2, y: 1, layer: 3 }, source, [130, 130], region);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].origin, [2 * TILE_PITCH, TILE_PITCH + region.dy, 3]);
  assert.deepEqual(writes[0].size, { width: 8, height: 132 });
  const rowBytes = Math.ceil(130 / 4) * 16;
  assert.deepEqual(writes[0].layout, {
    offset: (124 / 4) * 16,
    bytesPerRow: rowBytes,
    rowsPerImage: 33,
  });
});

// Behaviour: tail levels land on their block-aligned offsets, the 1×1 as one block at 128, and a
// level whose bytes are not the whole blocks its size implies is refused — tile or tail.
test('tail levels are written block by block at their aligned offsets', () => {
  const { queue, writes } = fakeQueue();
  const place = { x: 0, y: 0, layer: 0 };
  const tail = [64, 32, 16, 8, 4, 2, 1].map((side) => level(side, side));
  writeTailFromBlocks(queue, pool, place, [64, 64], 0, tail);
  assert.deepEqual(
    writes.map((w) => (w.origin as number[])[0]),
    [0, 1, 2, 3, 4, 5, 6].map((rank) => TILE_BORDER + tailOffset(rank)),
  );
  assert.deepEqual(writes[6].size, { width: 4, height: 4 });
  assert.deepEqual(writes[0].size, { width: 64, height: 64 });
  // A tail level of the wrong length is refused here; a tile's level is refused before its slot
  // is taken, in `sources.ts`.
  assert.throws(
    () =>
      writeTailFromBlocks(queue, pool, place, [64, 64], 0, [new Uint8Array(15), ...tail.slice(1)]),
    /TEXTURE_LEVEL_BYTES/,
  );
});
