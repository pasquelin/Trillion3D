import test from 'node:test'
import assert from 'node:assert/strict'
import { ceilFloat32, floorFloat32, writeSplitDouble } from './splitDouble.ts'
import { FLOAT32_MAX } from '../constants.ts'
import { edgeValues, HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

test('float bounds round outward, including subnormals and negative values', () => {
  for (const value of [-1e9 - 0.01, -1.01, -1e-46, -0, 0, 1e-46, 0.001, 1.01, 1e9 + 0.01, Infinity])
    assert.ok(ceilFloat32(value) >= value, `${value}`)
  assert.ok(Number.isNaN(ceilFloat32(NaN)))
})

test('ceilFloat32 and floorFloat32 match the outward rounding they replace, bit for bit', () => {
  const rounded = new Float32Array(1),
    bits = new Uint32Array(rounded.buffer)
  const old = (value: number, upper: boolean) => {
    rounded[0] = value
    if (upper ? rounded[0] < value : rounded[0] > value) {
      if (rounded[0] === 0) bits[0] = upper ? 1 : 0x80000001
      else bits[0] += rounded[0] > 0 === upper ? 1 : -1
    }
    return rounded[0]
  }
  const values = [
    ...edgeValues(-Infinity, Infinity),
    Infinity,
    -Infinity,
    NaN,
    1e-46,
    -1e-46,
    1e39,
    -1e39,
  ]
  for (const [lo, hi] of [
    [-2, 2],
    [-1e-38, 1e-38],
    [-1e-44, 1e-44],
    [-1e39, 1e39],
    [-1e9, 1e9],
  ])
    for (let i = 1; i <= HALTON_SWEEP; i++)
      values.push(haltonSpan(i, 2, lo, hi), haltonSpan(i, 3, lo, hi))
  values.push(FLOAT32_MAX * (1 + 2 ** -30), -FLOAT32_MAX * (1 + 2 ** -30))
  for (const value of values) {
    assert.ok(Object.is(ceilFloat32(value), old(value, true)), `ceil ${value}`)
    assert.ok(Object.is(floorFloat32(value), old(value, false)), `floor ${value}`)
  }
})

test('split coordinates retain centimetres and millimetres across high-word rounding boundaries', () => {
  const out = new Float32Array(2)
  for (const origin of [0, -1e6, 1e6, -1e9, 1e9])
    for (const delta of [0.001, 0.01, 31.999, 32.001]) {
      const value = origin + delta
      writeSplitDouble(out, 0, 1, value)
      assert.ok(Math.abs(out[0] + out[1] - value) < 2e-6)
    }
})

test('a double sink keeps the residue exact: the high float32, then value − high', () => {
  const out = new Float64Array(6)
  for (const value of [0.1, -1e6 - 0.001, 1e9 + 0.01, 2 ** 24 + 0.5]) {
    writeSplitDouble(out, 1, 4, value)
    assert.equal(out[1], Math.fround(value))
    assert.equal(out[4], value - Math.fround(value))
    assert.equal(out[1] + out[4], value)
  }
  const single = new Float32Array(2)
  writeSplitDouble(single, 0, 1, 0.1)
  assert.equal(single[1], Math.fround(0.1 - Math.fround(0.1)))
})
