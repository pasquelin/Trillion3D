// The runtime page cutter's formulas in their packages/math homes, each against the expression
// it replaced (`hypot3`, `Math.hypot` to the bit, is the old length in every oracle).
//
// The deformation reaches leave `hypot3` for `length3`: a joint's rest ball and a morph target's
// radius, conservative reaches the deformation records grow bounds by and skip a still mesh on.
// The sweep holds each radius the same in float32; past it, a last-bit move in float64 can turn a
// comparison only at an exact tie.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
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
