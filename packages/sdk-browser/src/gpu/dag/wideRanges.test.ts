// The one run writer joins records by their bytes, whatever their width: scattered moves of links,
// exact translations, worlds, tree nodes or cards write about what moved, never every record
// between the lowest and the highest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeRanges } from './split.ts'

/** The bytes `count` scattered indices of `stride` words cost, written through `writeRanges`. */
function sent(stride: number, indices: number[]) {
  let bytes = 0,
    writes = 0
  const data = new Float32Array((indices.at(-1)! + 1) * stride)
  writeRanges(
    {} as GPUDevice,
    (_offset, _data, _from, size) => ((bytes += size), writes++),
    Int32Array.from(indices),
    indices.length,
    { data, sourceBase: 0, targetBase: 0, stride },
  )
  return { bytes, writes }
}

test('scattered moves write what moved, not the span between them, whatever the record', () => {
  let seed = 5
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const indices = [...new Set(Array.from({ length: 300 }, () => Math.floor(next() * 3e5)))].sort(
    (a, b) => a - b,
  )
  for (const stride of [1, 8, 16, 24, 28]) {
    const { bytes } = sent(stride, indices)
    assert.ok(
      bytes <= indices.length * Math.max(stride * 4 * 2, 256 + stride * 4),
      `${bytes} bytes for ${indices.length} moves`,
    )
  }
})

test('neighbouring wide records share a write', () => {
  const { writes, bytes } = sent(16, [10, 11, 12, 14, 900])
  assert.equal(writes, 2)
  assert.equal(bytes, (5 + 1) * 64)
})
