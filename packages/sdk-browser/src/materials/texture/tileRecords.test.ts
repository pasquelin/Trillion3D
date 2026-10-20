import test from 'node:test'
import assert from 'node:assert/strict'
import { recordRange, tileRecord } from './tileRecords.ts'
import { tiledLevelFile } from './tileRecords.fixture.ts'
import { tilesAt } from './tiles.ts'
import { tileRegion } from '../virtual/write.ts'
import { writeTileFromBlocks } from '../virtual/writeBlocks.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** `rows` block rows of `blocks` blocks from `data`, `stride` bytes apart from `offset`. */
function rowsOf(data: Uint8Array, offset: number, stride: number, rows: number, blocks: number) {
  const out: number[] = []
  for (let row = 0; row < rows; row++)
    out.push(...data.subarray(offset + row * stride, offset + row * stride + blocks * 16))
  return out
}

// The record sizes the compiler's tiled file is written with (`tile_records`, pinned by the same
// numbers in `asset-compiler-rust/src/texture_preview/tests/tile_records.rs`), and where each
// record's compressed bytes lie, read from the file's head.
test('a tile record’s rank and size follow from the level’s dimensions, its place from the head', () => {
  const at = (tx: number, ty: number) => tileRecord(769, 300, tx, ty)
  assert.deepEqual(
    [at(1, 1).index, at(1, 1).count, at(1, 1).bytes, at(6, 2).index, at(6, 2).bytes],
    [8, 21, 18_496, 20, 384],
  )
  let inflated = 0
  for (let i = 0; i < 21; i++) inflated += at(i % 7, Math.floor(i / 7)).bytes
  assert.equal(inflated, 259_120)
  assert.equal(tileRecord(100, 8, 0, 0).bytes, 25 * 2 * 16, 'one tile: its row-major blocks')
  const { file } = tiledLevelFile(769, 300)
  let end = 21 * 4
  for (let i = 0; i < 21; i++) {
    const range = recordRange(file.subarray(0, 21 * 4), 21, i)
    assert.equal(range.offset, end, `record ${i} follows the one before`)
    end += range.bytes
  }
  assert.equal(end, file.byteLength, 'the last record closes the file')
})

// Records follow tile rows then tiles, and a tile written from its record — its region's
// blocks — lands the very blocks the row-major level cuts, on random sizes and edges.
test('a tile written from its record lands the blocks the whole-level cut wrote', () => {
  const next = lcgRandom(962)
  const sizes = [1, 128, 129, 769, 4096, 260].map((w, i) => [w, [1, 128, 5, 300, 12, 1031][i]])
  for (let i = 0; i < 20; i++) sizes.push([next() * 700, next() * 700].map(Math.ceil))
  let landed: number[] = []
  const queue = {
    writeTexture(
      _: unknown,
      data: Uint8Array,
      at: GPUTexelCopyBufferLayout,
      size: GPUExtent3DDict,
    ) {
      landed = rowsOf(data, at.offset!, at.bytesPerRow!, size.height! / 4, size.width / 4)
    },
  } as unknown as GPUQueue
  for (const [width, height] of sizes) {
    const row = ceilDiv(width, 4) * 16
    const level = Uint8Array.from({ length: row * ceilDiv(height, 4) }, () => next() * 256)
    const [tw, th] = tilesAt(width, height, 0)
    let end = 0
    for (let ty = 0; ty < th; ty++)
      for (let tx = 0; tx < tw; tx++) {
        const region = tileRegion(width, height, tx, ty),
          { sx, sy } = region
        const [across, down] = [ceilDiv(region.width, 4), ceilDiv(region.height, 4)]
        const { index, bytes } = tileRecord(width, height, tx, ty),
          name = `${width}×${height} tile ${tx},${ty}`
        assert.deepEqual([index, bytes], [end, across * down * 16], name)
        end++
        const developCut = rowsOf(level, (sy / 4) * row + (sx / 4) * 16, row, down, across)
        const record = Uint8Array.from(developCut)
        writeTileFromBlocks(queue, {} as GPUTexture, { x: 0, y: 0, layer: 0 }, record, region)
        assert.deepEqual(landed, developCut, name)
      }
    assert.equal(end, tileRecord(width, height, 0, 0).count, `${width}×${height}`)
  }
})
