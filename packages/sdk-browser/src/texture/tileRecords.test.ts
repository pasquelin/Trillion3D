import test from 'node:test'
import assert from 'node:assert/strict'
import { tileRecord, tiledLevelBytes } from './tileRecords.ts'
import { tilesAt } from './tiles.ts'
import { tileRegion } from '../webgpu/tile/write.ts'
import { writeTileFromBlocks } from '../webgpu/tile/writeBlocks.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'

/** `rows` block rows of `blocks` blocks from `data`, `stride` bytes apart from `offset`. */
function rowsOf(data: Uint8Array, offset: number, stride: number, rows: number, blocks: number) {
  const out: number[] = []
  for (let row = 0; row < rows; row++)
    out.push(...data.subarray(offset + row * stride, offset + row * stride + blocks * 16))
  return out
}

// #962: the offsets the compiler's tiled file is written at (`tile_records`, pinned by the same
// numbers in `asset-compiler-rust/src/texture_preview/tests/tile_records.rs`).
test('a tile record’s place in its level file follows from the level’s dimensions', () => {
  assert.equal(tiledLevelBytes(769, 300), 259_120)
  assert.deepEqual(tileRecord(769, 300, 1, 1), { offset: 126_192, bytes: 18_496 })
  assert.deepEqual(tileRecord(769, 300, 6, 2), { offset: 258_736, bytes: 384 })
  assert.equal(tiledLevelBytes(100, 8), 25 * 2 * 16, 'one tile: its row-major blocks')
})

// E0, #962: records tile the file end to end, and a tile written from its record — its region's
// blocks — lands the very blocks develop cut from the row-major level, on random sizes and edges.
test('a tile written from its record lands the blocks the whole-level cut wrote', () => {
  const next = random(962)
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
    const row = Math.ceil(width / 4) * 16
    const level = Uint8Array.from({ length: row * Math.ceil(height / 4) }, () => next() * 256)
    const [tw, th] = tilesAt(width, height, 0)
    let end = 0
    for (let ty = 0; ty < th; ty++)
      for (let tx = 0; tx < tw; tx++) {
        const region = tileRegion(width, height, tx, ty),
          { sx, sy } = region
        const [across, down] = [Math.ceil(region.width / 4), Math.ceil(region.height / 4)]
        const { offset, bytes } = tileRecord(width, height, tx, ty),
          name = `${width}×${height} tile ${tx},${ty}`
        assert.deepEqual([offset, bytes], [end, across * down * 16], name)
        end += bytes
        const developCut = rowsOf(level, (sy / 4) * row + (sx / 4) * 16, row, down, across)
        const record = Uint8Array.from(developCut)
        writeTileFromBlocks(queue, {} as GPUTexture, { x: 0, y: 0, layer: 0 }, record, region)
        assert.deepEqual(landed, developCut, name)
      }
    assert.equal(end, tiledLevelBytes(width, height), `${width}×${height}`)
  }
})
