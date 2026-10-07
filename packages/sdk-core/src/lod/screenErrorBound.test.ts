// `clusterErrorAtDepth`'s guard, verdict by verdict: a zero error is 0 and an infinite one infinity
// before any check, one value out of its domain refuses the call by name, and every call it lets
// through projects as `screenErrorBound` does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterErrorAtDepth, screenErrorBound } from './screenErrorBound.ts'

type Args = [number, number, number, number, number, number, number, number]

/** error, stretch, axis distance, depth, radius, focal length, near plane, clip-w weight. */
const BASE: Args = [0.02, 1.5, 3, 40, 0.8, 900, 0.1, 1]

/** `BASE` with `value` at `slot`, and the error at `error` when given. */
const at = (slot: number, value: number, error = BASE[0]): Args => {
  const a = [...BASE] as Args
  a[0] = error
  a[slot] = value
  return a
}

/** Each slot's values out of its domain. */
const REFUSED: [number, number[]][] = [
  [0, [NaN, -1, -Infinity, -1e-300]],
  [1, [NaN, -1, Infinity, -Infinity]],
  [2, [NaN, -1, Infinity, -Infinity]],
  [3, [NaN, Infinity, -Infinity]],
  [4, [NaN, -1, Infinity, -Infinity]],
  [5, [NaN, 0, -0, -1, Infinity]],
  [6, [NaN, 0, -0, -1, Infinity]],
  [7, [NaN, -1e-300, 1 + 2 ** -52, 2]],
]

test('a zero or infinite error is answered before any check', () => {
  for (const [slot, values] of REFUSED.slice(1))
    for (const value of values) {
      assert.equal(clusterErrorAtDepth(...at(slot, value, 0)), 0)
      assert.equal(clusterErrorAtDepth(...at(slot, value, Infinity)), Infinity)
    }
})

test('one value out of its domain refuses the call by name', () => {
  for (const [slot, values] of REFUSED)
    for (const value of values)
      assert.throws(() => clusterErrorAtDepth(...at(slot, value)), {
        name: 'Error',
        message: 'Invalid cluster parameters',
      })
})

test('a call the guard lets through projects as screenErrorBound, to the bit', () => {
  const edges = [0, -0, 1e-300, 0.5, 1, 2, 1e300]
  for (let slot = 1; slot < BASE.length; slot++)
    for (const value of slot === 7 ? [0, -0, 0.5, 1] : edges) {
      const a = at(slot, value)
      if ((slot === 5 || slot === 6) && value <= 0) continue
      assert.ok(Object.is(clusterErrorAtDepth(...a), screenErrorBound(...a)), a.join(', '))
    }
  // A receiver behind the eye or at the near plane is still a projection, not a refusal.
  for (const depth of [-5, 0.1, 0])
    assert.ok(Object.is(clusterErrorAtDepth(...at(3, depth)), screenErrorBound(...at(3, depth))))
})
