// sphere.ts sphereUnion: the smallest sphere around two — exact cases, containment of both on a
// sweep, and the bounds fold it replaces bit for bit.
import assert from 'node:assert/strict'
import test from 'node:test'
import { sphereUnion } from './sphere.ts'
import { distanceVector3 } from '../vector/vector.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

/** The fold it replaces, the gap's length a plain root of three squares: an empty sphere read is
 *  skipped, one held is replaced; a sphere holding the other is kept; else the union through both. */
function oldGrow(into: Float64Array, at: number, sphere: ArrayLike<number>, from: number) {
  const read = [0, 1, 2, 3].map((k) => sphere[from + k]),
    held = into.subarray(at, at + 4)
  if (!(read[3] >= 0)) return
  const gap = [0, 1, 2].map((k) => read[k] - held[k])
  const distance = Math.sqrt(gap[0] * gap[0] + gap[1] * gap[1] + gap[2] * gap[2])
  if (held[3] >= 0 && distance + read[3] <= held[3]) return
  if (!(held[3] >= 0) || distance + held[3] <= read[3]) return held.set(read)
  const next = (distance + held[3] + read[3]) * 0.5,
    ratio = (next - held[3]) / distance
  for (let k = 0; k < 3; k++) held[k] += gap[k] * ratio
  held[3] = next
}

test('sphereUnion: two apart, one inside the other, and the empty sphere either side', () => {
  const into = Float64Array.of(9, 0, 0, 0, 1)
  sphereUnion(into, 1, [4, 0, 0, 1], 0)
  assert.deepEqual([...into], [9, 2, 0, 0, 3])
  sphereUnion(into, 1, [1, 0, 0, 0.5], 0)
  assert.deepEqual([...into], [9, 2, 0, 0, 3], 'a sphere inside changes nothing')
  sphereUnion(into, 1, [2, 0, 0, 10], 0)
  assert.deepEqual([...into], [9, 2, 0, 0, 10], 'a sphere around takes its place')
  sphereUnion(into, 1, [0, 0, 0, -1], 0)
  assert.deepEqual([...into], [9, 2, 0, 0, 10], 'an empty one read is skipped')
  const empty = Float64Array.of(0, 0, 0, -1)
  sphereUnion(empty, 0, [7, 8, 9, 2], 0)
  assert.deepEqual([...empty], [7, 8, 9, 2], 'an empty one held is replaced')
})

test('sphereUnion holds both spheres and is the old fold, bit for bit', () => {
  const held = new Float64Array(4),
    old = new Float64Array(4),
    read = new Float64Array(8)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    for (let k = 0; k < 3; k++) {
      held[k] = haltonSpan(i, [2, 3, 5][k], -100, 100)
      read[4 + k] = haltonSpan(i, [7, 11, 13][k], -100, 100)
    }
    held[3] = haltonSpan(i, 17, 0, 60)
    read[7] = haltonSpan(i, 19, 0, 60)
    const before = Float64Array.from(held)
    old.set(held)
    oldGrow(old, 0, read, 4)
    sphereUnion(held, 0, read, 4)
    for (let k = 0; k < 4; k++) assert.ok(Object.is(held[k], old[k]), `${i}.${k}`)
    const slack = 1e-12 * (1 + held[3])
    assert.ok(distanceVector3(held, before) + before[3] <= held[3] + slack, `held ${i}`)
    assert.ok(distanceVector3(held, read, 0, 4) + read[7] <= held[3] + slack, `read ${i}`)
  }
})

test("sphereUnion keeps the old fold's plain root outside the length band, as its Rust twin", () => {
  // Two point spheres 1e-160 apart: the squares underflow, the gap is 0 and the held one is kept
  // as it is. Two 1e155 apart: the squares overflow, the gap is Infinity and the centre NaN.
  for (const gap of [1e-160, 1e155]) {
    const held = Float64Array.of(0, 0, 0, 0),
      old = Float64Array.from(held),
      read = [gap, 0, 0, 0]
    oldGrow(old, 0, read, 0)
    sphereUnion(held, 0, read, 0)
    for (let k = 0; k < 4; k++) assert.ok(Object.is(held[k], old[k]), `${gap}.${k}`)
  }
})
