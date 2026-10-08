import test from 'node:test'
import assert from 'node:assert/strict'
import { proxyAffineDelta } from './proxyDelta.ts'
import { determinantMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { composeMatrix4 } from '../../../../math/src/matrix/matrix4Compose.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { oldAffineDelta } from '../../../../../bench/oracles/core/length-rule.ts'

// The plane's normal moved from `Math.hypot` and three divisions to the length rule
// (`normalizeVector3`: `Math.sqrt` of the squares, then one reciprocal and three products). The
// oracle is the former expression, kept word for word (`oldAffineDelta`); the delta reaches the GPU
// through the proxy's Float32Array transforms, so each of its sixteen terms must round to the
// same single-precision bits. A zero normal (two parallel axes) was +0 and is now the cross's own
// ±0: the motion test compares with `===` and a zero of either sign scales a residual the same, so
// those cases are held to `===`. The rule overflows past a cross of ~1.3e154 and underflows below
// ~1.5e-162, which needs plane columns beyond 1e77 or under 1e-77: a placement outside single
// precision, which no transform buffer carries.

/** A placement from four Halton coordinates: a uniform rotation, scales in ±[0.05, 20],
 *  a translation within 100 m; the axis `flat` is scaled to zero when given. */
function placement(index: number, flat: number) {
  const u = [2, 3, 5, 7].map((base) => halton(index, base))
  const r = Math.sqrt(1 - u[0]),
    s = Math.sqrt(u[0])
  const turn = [
    r * Math.sin(2 * Math.PI * u[1]),
    r * Math.cos(2 * Math.PI * u[1]),
    s * Math.sin(2 * Math.PI * u[2]),
    s * Math.cos(2 * Math.PI * u[2]),
  ]
  const scale = [0.05 + 20 * u[3], 0.05 + 20 * u[0], 0.05 + 20 * u[2]]
  if (index % 5 === 0) scale[index % 3] = -scale[index % 3]
  if (flat >= 0) scale[flat] = 0
  const position = [200 * u[1] - 100, 200 * u[2] - 100, 200 * u[3] - 100]
  return composeMatrix4(new Float64Array(16), position, turn, scale)
}

/** The sixteen terms rounded to single precision: identical bits, or with `anyZero` a zero of
 *  either sign for a zero. */
function assertSameDelta(bind: Float64Array, world: Float64Array, label: string, anyZero = false) {
  const bindInverse = invertMatrix4(new Float64Array(16), bind)
  const before = oldAffineDelta(new Float64Array(16), bind, world, bindInverse)
  const after = proxyAffineDelta(new Float64Array(16), bind, world, bindInverse)
  for (let i = 0; i < 16; i++) {
    const was = Math.fround(before[i]),
      is = Math.fround(after[i])
    const same = anyZero && was === 0 ? is === 0 : Object.is(was, is)
    assert.ok(same, `${label}: term ${i} ${was} → ${is}`)
  }
}

test('a flattened bind gives the same single-precision delta over 4096 Halton poses', () => {
  for (let i = 1; i <= 4096; i++) {
    const flat = i % 3
    const bind = placement(i, flat)
    assert.equal(determinantMatrix4(bind), 0)
    assertSameDelta(bind, placement(i + 4096, i % 2 ? flat : -1), `pose ${i}`)
  }
})

test('the edges keep their delta: axis-aligned planes, parallel axes, a zero plane', () => {
  const unit = (sx: number, sy: number, sz: number) =>
    composeMatrix4(new Float64Array(16), [1, 2, 3], [0, 0, 0, 1], [sx, sy, sz])
  const twisted = placement(17, -1)
  for (const [label, bind, world] of [
    ['flat z', unit(1, 1, 0), unit(2, 3, 4)],
    ['flat x', unit(0, 1, 1), unit(-1, 1, 1)],
    ['flat y, −0', unit(1, -0, 1), twisted],
  ] as const)
    assertSameDelta(bind, world, label)
  for (const [label, bind, world] of [
    ['line', unit(1, 0, 0), twisted],
    ['point', unit(0, 0, 0), unit(0, 0, 0)],
    ['world on a line', unit(1, 1, 0), unit(0, 1, 0)],
  ] as const)
    assertSameDelta(bind, world, label, true)
  const parallel = placement(23, -1)
  for (let row = 0; row < 3; row++) parallel[8 + row] = parallel[row]
  assertSameDelta(parallel, twisted, 'parallel columns')
})
