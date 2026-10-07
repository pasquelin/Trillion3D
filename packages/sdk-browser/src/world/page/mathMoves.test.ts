// The runtime page cutter's formulas in their packages/math homes, each against the expression
// it replaced (`hypot3`, `Math.hypot` to the bit, is the old length in every oracle).
//
// The deformation reaches leave `hypot3` for `length3`: a joint's rest ball and a morph target's
// radius, conservative reaches the deformation records grow bounds by and skip a still mesh on.
// The sweep holds each radius the same in float32; past it, a last-bit move in float64 can turn a
// comparison only at an exact tie. A compact run's triangle area and longest edge leave `hypot3`
// for `length3` and `distanceVector3`: they only decide where a run ends, and the sweep holds
// every cluster range the same on jittered grid strips and on triangle soups.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { boxEmpty, boxExpandByPoint } from '../../../../math/src/geometry/box.ts'
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { clusters } from './cutClusters.ts'
import { runtimeDeformation } from './runtimeDeformation.ts'

test('the joint rest balls and target radii are the old ones in float32', () => {
  const coordinates = edgeValues(-1e3, 1e3)
  for (let i = 1; i <= HALTON_SWEEP; i++) coordinates.push(haltonSpan(i, 2, -1e3, 1e3))
  const n = coordinates.length
  // Joint `j` weighs vertices `2j` and `2j + 1`; target `j` moves one vertex by the `j`-th offset.
  const positions = new Float32Array(n * 6),
    offsets = new Float32Array(n * 3)
  for (let j = 0; j < n; j++) {
    const k = j + 1
    positions.set([coordinates[j], haltonSpan(k, 3, -1e3, 1e3), haltonSpan(k, 5, -1e3, 1e3)], j * 6)
    positions.set([haltonSpan(k, 7, -1e3, 1e3), haltonSpan(k, 11, -1e3, 1e3)], j * 6 + 3)
    positions[j * 6 + 5] = haltonSpan(k, 13, -1e3, 1e3)
    offsets.set([haltonSpan(k, 17, -9, 9), coordinates[j] / 100, haltonSpan(k, 19, -9, 9)], j * 3)
  }
  const deformation = {
    influences: 1,
    joints: Uint16Array.from({ length: 2 * n }, (_, v) => v >> 1),
    weights: new Float32Array(2 * n).fill(1),
    targets: Array.from({ length: n }, (_, j) => ({
      positions: offsets.subarray(j * 3, j * 3 + 3),
    })),
  }
  const reaches = runtimeDeformation({ positions, deformation } as unknown as DrawnTriangles)!
  for (let j = 0; j < n; j++) {
    const ball: number[] = []
    for (let c = 0; c < 3; c++) {
      const a = positions[j * 6 + c],
        b = positions[j * 6 + 3 + c]
      ball.push((Math.min(a, b) + Math.max(a, b)) / 2)
    }
    const top = [0, 1, 2].map((c) => Math.max(positions[j * 6 + c], positions[j * 6 + 3 + c]))
    const old = hypot3(top[0] - ball[0], top[1] - ball[1], top[2] - ball[2])
    assertSameFloat32(old, reaches.joints[j * 4 + 3], `joint ${j}`)
    const moved = hypot3(offsets[j * 3], offsets[j * 3 + 1], offsets[j * 3 + 2])
    assertSameFloat32(Math.max(0, moved), reaches.targets[j], `target ${j}`)
  }
})

/** The old cutter's compact runs (`createRun` and `clusters`, `hypot3` lengths), its ranges. */
function oldClusters(indices: Uint32Array, vertexCount: number, at: Float32Array) {
  const p = (v: number, c: number) => at[v * 3 + c]
  const edge = (u: number, v: number) =>
    hypot3(p(v, 0) - p(u, 0), p(v, 1) - p(u, 1), p(v, 2) - p(u, 2))
  const compactSquared = (count: number, area: number, longest: number) => {
    const held = (128 * area) / count,
      side = Math.max(longest, Math.sqrt(held))
    return side ? side * side + (held / side) ** 2 : 0
  }
  const box = new Float64Array(6),
    grown = new Float64Array(6)
  let count = 0,
    area = 0,
    longest = 0,
    nextArea = 0,
    nextLongest = 0
  const measure = (a: number, b: number, c: number) => {
    const u = [0, 1, 2].map((k) => p(b, k) - p(a, k)),
      w = [0, 1, 2].map((k) => p(c, k) - p(a, k))
    nextArea =
      hypot3(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2
    nextLongest = Math.max(edge(a, b), edge(b, c), edge(c, a))
    grown.set(box)
    for (const v of [a, b, c]) boxExpandByPoint(grown, 0, p(v, 0), p(v, 1), p(v, 2))
  }
  // The run's step: the box's squared diagonal summed axis by axis from 0, the same sum.
  const add = (a: number, b: number, c: number, fresh: boolean) => {
    if (!fresh) {
      measure(a, b, c)
      let diagonal = 0
      for (let k = 0; k < 3; k++) diagonal += (grown[3 + k] - grown[k]) ** 2
      fresh = diagonal > compactSquared(count + 1, area + nextArea, Math.max(longest, nextLongest))
    }
    if (fresh) {
      ;[count, area, longest] = [0, 0, 0]
      boxEmpty(box, 0)
      measure(a, b, c)
    }
    box.set(grown)
    ;[count, area, longest] = [count + 1, area + nextArea, Math.max(longest, nextLongest)]
    return fresh
  }
  const ranges: [number, number][] = [],
    taken = new Uint32Array(vertexCount)
  let start = 0,
    cluster = 1,
    held = 0
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = indices.subarray(t, t + 3)
    const fresh =
      Number(taken[a] !== cluster) +
      Number(taken[b] !== cluster && b !== a) +
      Number(taken[c] !== cluster && c !== a && c !== b)
    const ends = (t - start) / 3 >= 128 || held + fresh > 255
    if (add(a, b, c, ends || t === start) && t > start) {
      ranges.push([start, t])
      start = t
      cluster++
      held = 0
    }
    for (const v of [a, b, c])
      if (taken[v] !== cluster) {
        taken[v] = cluster
        held++
      }
  }
  if (start < indices.length) ranges.push([start, indices.length])
  return ranges
}

test('compact runs on length3 end every cluster where the old ones did', () => {
  for (let mesh = 1; mesh <= 16; mesh++) {
    // A grid of 64 × 64 cells jittered by Halton points, cut in row order: a strip that strays.
    const side = 65,
      scale = 10 ** haltonSpan(mesh, 2, -3, 3),
      positions = new Float32Array(side * side * 3)
    for (let v = 0; v < side * side; v++) {
      const k = mesh * side * side + v
      positions[v * 3] = ((v % side) + haltonSpan(k, 3, -0.4, 0.4)) * scale
      positions[v * 3 + 1] = haltonSpan(k, 5, -0.4, 0.4) * scale
      positions[v * 3 + 2] = (Math.floor(v / side) + haltonSpan(k, 7, -0.4, 0.4)) * scale
    }
    const indices: number[] = []
    for (let y = 0; y < side - 1; y++)
      for (let x = 0; x < side - 1; x++) {
        const v = y * side + x
        indices.push(v, v + 1, v + side, v + 1, v + side + 1, v + side)
      }
    // Then triangles of Halton vertices: soups whose every triangle may end a run.
    for (let t = 0; t < 600; t++)
      indices.push(
        ...[0, 1, 2].map((c) =>
          Math.floor(haltonSpan(mesh * 600 + t, [11, 13, 17][c], 0, side * side)),
        ),
      )
    const list = Uint32Array.from(indices),
      count = side * side
    const now = [...clusters(list, count, positions)]
    assert.deepEqual(now, oldClusters(list, count, positions), `mesh ${mesh}`)
    assert.ok(now.length > list.length / 3 / 128, `mesh ${mesh} ends runs by their reach`)
  }
})
