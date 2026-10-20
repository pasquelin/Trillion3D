// The one run writer joins records by their bytes, whatever their width: scattered moves of links,
// exact translations, worlds, tree nodes or cards write about what moved, never every record
// between the lowest and the highest — past `WRITE_CAP` writes, the narrowest gaps join
// (`writeRule`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeRanges } from './runWrites.ts'
import { WRITE_CAP } from '../residency/ranges.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** The bytes `count` scattered indices of `stride` words cost, written through `writeRanges`. */
function sent(stride: number, indices: number[]) {
  let bytes = 0,
    writes = 0
  const data = new Float32Array((indices.at(-1)! + 1) * stride)
  writeRanges(
    (_offset, _data, _from, size) => ((bytes += size), writes++),
    Int32Array.from(indices),
    indices.length,
    { data, sourceBase: 0, targetBase: 0, stride },
  )
  return { bytes, writes }
}

test('scattered moves write what moved, not the span between them, whatever the record', () => {
  const next = lcgRandom(5)
  const scattered = (count: number) =>
    [...new Set(Array.from({ length: count }, () => Math.floor(next() * 3e5)))].sort(
      (a, b) => a - b,
    )
  // Under `WRITE_CAP` moves, each is its own write: what moved, a gap of 256 bytes at most beside.
  const few = scattered(WRITE_CAP - 4)
  for (const stride of [1, 8, 16, 24, 28]) {
    const { bytes } = sent(stride, few)
    assert.ok(
      bytes <= few.length * Math.max(stride * 4 * 2, 256 + stride * 4),
      `${bytes} bytes for ${few.length} moves`,
    )
  }
  // Past it, the narrowest gaps join into `WRITE_CAP` writes: the widest gaps stay unwritten.
  const many = scattered(300)
  for (const stride of [1, 8, 16, 24, 28]) {
    const { bytes, writes } = sent(stride, many)
    const span = (many.at(-1)! - many[0] + 1) * stride * 4
    assert.equal(writes, WRITE_CAP)
    assert.ok(bytes < span / 2, `${bytes} bytes for ${many.length} moves, ${span} spanned`)
  }
})

test('neighbouring wide records share a write', () => {
  const { writes, bytes } = sent(16, [10, 11, 12, 14, 900])
  assert.equal(writes, 2)
  assert.equal(bytes, (5 + 1) * 64)
})
