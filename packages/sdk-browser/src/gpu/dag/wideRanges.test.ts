// The one run writer joins wide records by their bytes: scattered moves of worlds, tree nodes or
// cards write about what moved, never every record between the lowest and the highest; narrow
// words keep the residency flush's rule.
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

test('scattered moves of wide records write what moved, not the span between them', () => {
  let seed = 5
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const indices = [...new Set(Array.from({ length: 300 }, () => Math.floor(next() * 3e5)))].sort(
    (a, b) => a - b,
  )
  for (const stride of [16, 24, 28]) {
    const { bytes } = sent(stride, indices)
    assert.ok(
      bytes <= indices.length * stride * 4 * 2,
      `${bytes} bytes for ${indices.length} moves`,
    )
  }
  // A narrow word keeps the residency rule: past 32 ranges, one write of everything.
  assert.equal(sent(1, indices).writes, 1)
})

test('neighbouring wide records share a write', () => {
  const { writes, bytes } = sent(16, [10, 11, 12, 14, 900])
  assert.equal(writes, 2)
  assert.equal(bytes, (5 + 1) * 64)
})
