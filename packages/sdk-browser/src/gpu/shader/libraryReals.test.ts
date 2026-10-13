// The fold, remap, texel, wireframe and extent declarations of the maths library
// (`packages/math/src/wgsl/reals.ts`, `sampling.ts`, `barycentric.ts`, `geometry.ts`),
// their shipped text run in JavaScript against the processor's twins and what each one claims.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  floorMod,
  floorMod2,
  signedToUnit3,
  unitToSigned2,
  unitToSigned3,
} from '../../../../math/src/wgsl/reals.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { wireframeEdge } from '../../../../math/src/wgsl/barycentric.ts'
import { rayInverseDirection, transformHalfExtent } from '../../../../math/src/wgsl/geometry.ts'
import { floorMod as floorModTs } from '../../../../math/src/scalar/reals.ts'
import { haltonSpan } from '../../../../math/src/sequence/sweep.fixture.ts'

type V = number[]
type F = (...args: never[]) => never
const NAMES = [
  'floorMod',
  'floorMod2',
  'unitToSigned2',
  'unitToSigned3',
  'signedToUnit3',
  'clampToExtent',
  'wireframeEdge',
  'transformHalfExtent',
  'rayInverseDirection',
]
const run = shaderRun<Record<string, F>>(
  wgslModule(
    floorMod,
    floorMod2,
    unitToSigned2,
    unitToSigned3,
    signedToUnit3,
    clampToExtent,
    wireframeEdge,
    transformHalfExtent,
    rayInverseDirection,
  ),
  NAMES,
  {},
)
const call = (name: string, ...args: unknown[]) =>
  (run[name] as (...a: unknown[]) => never)(...args)

test('floorMod is the processor floorMod; floorMod2 the fold by 2, into [0, 2)', () => {
  for (let k = 0; k < 2000; k++) {
    const x = haltonSpan(k + 1, 2, -40, 40),
      n = haltonSpan(k + 1, 3, 0.25, 9)
    assert.ok(Object.is(call('floorMod', x, n), floorModTs(x, n)), `${x} ${n}`)
    const folded = call('floorMod2', x) as number
    assert.ok(folded >= 0 && folded < 2, `${x}`)
    assert.ok(Number.isInteger((x - folded) / 2), `${x}`)
  }
  assert.equal(call('floorMod2', -0.5), 1.5)
  assert.equal(call('floorMod', -7, 3), 2)
})

test('unit and signed remaps: the ends meet, and each undoes the other', () => {
  assert.deepEqual(call('unitToSigned2', [0, 1]), [-1, 1])
  assert.deepEqual(call('unitToSigned3', [0, 0.5, 1]), [-1, 0, 1])
  assert.deepEqual(call('signedToUnit3', [-1, 0, 1]), [0, 0.5, 1])
  for (const v of [0.25, 0.75, 0.125])
    assert.deepEqual(call('signedToUnit3', call('unitToSigned3', [v, v, v])), [v, v, v])
})

test('clampToExtent holds a texel on its image, edges included', () => {
  assert.deepEqual(call('clampToExtent', [-3, 7], [4, 8]), [0, 7])
  assert.deepEqual(call('clampToExtent', [4, 8], [4, 8]), [3, 7])
  assert.deepEqual(call('clampToExtent', [2, 3], [4, 8]), [2, 3])
  assert.deepEqual(call('clampToExtent', [5, -1], [1, 1]), [0, 0])
})

test('wireframeEdge: 1 on an edge, 0 past 1.2 pixel widths from all three', () => {
  const width = [0.01, 0.02, 0.04]
  assert.equal(call('wireframeEdge', [0, 0.5, 0.5], width), 1)
  assert.equal(call('wireframeEdge', [0.4, 0.3, 0.3], width), 0)
  // Half the ramp from the first edge: the smoothstep's midpoint.
  assert.equal(call('wireframeEdge', [0.006, 0.5, 0.494], width), 0.5)
  // The nearest edge in widths decides: 0.012 is past x's ramp but inside z's.
  const edge = call('wireframeEdge', [0.5, 0.488, 0.012], width) as number
  const t = 0.012 / (0.04 * 1.2)
  assert.ok(Math.abs(edge - (1 - t * t * (3 - 2 * t))) < 1e-12)
})

test('transformHalfExtent is the processor transformHalfExtent on a world matrix', () => {
  const out = new Float64Array(3)
  for (let k = 1; k < 300; k++) {
    const m = Array.from({ length: 16 }, (_, i) =>
      haltonSpan(k * 16 + i, [2, 3, 5, 7][i % 4], -3, 3),
    )
    const e = [haltonSpan(k, 2, 0, 4), haltonSpan(k, 3, 0, 4), haltonSpan(k, 5, 0, 4)]
    // The absolute rows of the linear part against the half extents, summed left to right.
    for (let r = 0; r < 3; r++)
      out[r] = Math.abs(m[r]) * e[0] + Math.abs(m[4 + r]) * e[1] + Math.abs(m[8 + r]) * e[2]
    assert.deepEqual(call('transformHalfExtent', new Mat(m), e), [...out], `${k}`)
  }
})

test('rayInverseDirection holds a component under DIVISOR_FLOOR at +1e-20', () => {
  // The literal names the f32 of 1e-20: the device's quotient is the f32 of the double one.
  const inverse = (d: V) => (call('rayInverseDirection', d) as V).map(Math.fround)
  const far = Math.fround(1 / Math.fround(1e-20))
  assert.deepEqual(inverse([2, -4, 0]), [0.5, -0.25, far])
  assert.deepEqual(inverse([0, -1e-30, 1]), [far, far, 1])
})
