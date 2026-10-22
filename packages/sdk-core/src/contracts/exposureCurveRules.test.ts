// The exposure compensation curve: its baked table, its key interpolation and its extrapolation.
import test from 'node:test'
import { EXPOSURE_CURVE_SAMPLES, resolveExposureCurve } from './exposureCurve.ts'
import { exposureCurveAt } from './exposureCurveEval.ts'
import { bakeExposureCurve, exposureCurveFactor } from './exposureCurveTable.ts'
import assert from 'node:assert/strict'

test('the exposure compensation curve bakes 64 factors over EV100 -10 to 20', () => {
  assert.equal(resolveExposureCurve(undefined), null)
  assert.equal(resolveExposureCurve(false), null)
  assert.equal(resolveExposureCurve([]), null)
  assert.ok(bakeExposureCurve(null).every((factor) => factor === 1))
  // Keys are sorted; the compensation is linear between them and held past the ends.
  const curve = resolveExposureCurve([
    [10, -2],
    [0, 1],
  ])
  assert.deepEqual(
    curve?.keys.map((key) => [key.ev, key.compensation]),
    [
      [0, 1],
      [10, -2],
    ],
  )
  assert.equal(exposureCurveAt(curve, -5), 1)
  assert.equal(exposureCurveAt(curve, 5), -0.5)
  assert.equal(exposureCurveAt(curve, 15), -2)
  const table = bakeExposureCurve(curve)
  assert.equal(table.length, EXPOSURE_CURVE_SAMPLES)
  assert.equal(table[0], 2) // EV100 -10, held at the first key: 2^1
  assert.equal(table[63], 0.25) // EV100 20, held at the last key: 2^-2
  assert.equal(table[21], 2) // sample 21 is EV100 -10 + 21 · 30 / 63 = 0: the first key
  assert.equal(table[42], 0.25) // sample 42 is EV100 10: the last key
  // Sample 31 is EV100 4.7619...: 2^(1 - 3 · 0.47619) held as a half float.
  assert.equal(table[31], Math.f16round(2 ** (1 - 3 * (4.761904761904762 / 10))))
  // The shader's read: samples mixed, the ends held.
  assert.equal(exposureCurveFactor(table, 0), 2)
  assert.equal(exposureCurveFactor(table, -50), 2)
  assert.equal(exposureCurveFactor(table, 50), 0.25)
  assert.throws(
    () =>
      resolveExposureCurve([
        [0, 1],
        [0, 2],
      ]),
    /share the EV100/,
  )
  assert.throws(() => resolveExposureCurve([[0, Number.NaN]]), /finite number/)
  assert.throws(
    () => resolveExposureCurve([{ ev: 0, compensation: 0, interpolation: 'spline' }] as never),
    /interpolation/,
  )
})

test('an exposure curve key runs to the next as a line, a step or a cubic by its tangents', () => {
  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)
  // A step holds the key's value up to the next key, which it then takes.
  const step = resolveExposureCurve([
    { ev: 0, compensation: 1, interpolation: 'constant' },
    [10, 3],
  ])
  assert.equal(exposureCurveAt(step, 5), 1)
  assert.equal(exposureCurveAt(step, 9.999), 1)
  assert.equal(exposureCurveAt(step, 10), 3)
  // Auto tangents: (0,0), (10,10), (20,0) all cubic. The middle one is (10 - 0 + 0 - 10) / 20 = 0,
  // the ends flat; the first segment is the Bezier 0, 0, 10, 10: at 2.5, t = 0.25,
  // 3 · 0.75 · 0.0625 · 10 + 0.015625 · 10 = 1.5625.
  const flat = resolveExposureCurve(
    [0, 10, 20].map((ev, i) => ({
      ev,
      compensation: [0, 10, 0][i],
      interpolation: 'cubic' as const,
    })),
  )
  assert.deepEqual(
    flat?.keys.map((key) => [key.arriveTangent, key.leaveTangent]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  )
  near(exposureCurveAt(flat, 2.5), 1.5625)
  // A middle key at (10,10) between (0,0) and (30,10): tangent (10 - 0 + 10 - 10) / 30 = 1/3; the
  // first segment's second handle is 10 - (1/3) · 10 / 3, and at 5 the value is
  // 0.375 · 8.8888... + 0.125 · 10 = 4.58333...
  const skewed = resolveExposureCurve([
    { ev: 0, compensation: 0, interpolation: 'cubic' },
    { ev: 10, compensation: 10, interpolation: 'cubic' },
    { ev: 30, compensation: 10, interpolation: 'cubic' },
  ])
  near(skewed?.keys[1].arriveTangent ?? 0, 1 / 3)
  near(skewed?.keys[1].leaveTangent ?? 0, 1 / 3)
  near(exposureCurveAt(skewed, 5), 0.375 * (10 - 10 / 9) + 1.25)
  // User tangents: leave 0 at the first, arrive 2 at the second: handles 0 and 10 - 2 · 10 / 3,
  // at 5: 0.375 · 3.3333... + 0.125 · 10 = 2.5.
  const user = resolveExposureCurve([
    { ev: 0, compensation: 0, interpolation: 'cubic', tangentMode: 'user', leaveTangent: 0 },
    { ev: 10, compensation: 10, tangentMode: 'user', arriveTangent: 2 },
  ])
  near(exposureCurveAt(user, 5), 2.5)
  // A user tangent written on one side is the other's too.
  assert.equal(
    resolveExposureCurve([{ ev: 0, compensation: 0, tangentMode: 'user', leaveTangent: 2 }])
      ?.keys[0].arriveTangent,
    2,
  )
  // Broken tangents: leave 3 and arrive 0 give handles 10 and 10; at 5:
  // 0.375 · 10 + 0.375 · 10 + 0.125 · 10 = 8.75.
  const broken = resolveExposureCurve([
    { ev: 0, compensation: 0, interpolation: 'cubic', tangentMode: 'break', leaveTangent: 3 },
    { ev: 10, compensation: 10, tangentMode: 'break', arriveTangent: 0 },
  ])
  near(exposureCurveAt(broken, 5), 8.75)
  // Weighted handles, tangents 0, weights 5: the handles' times are 5 and 5, so the Bezier of the
  // times 0, 0.5, 0.5, 1 is solved for 2.5 (a bisection here, not Cardano's formula), and the
  // values 0, 0, 10, 10 are read at that parameter.
  const weighted = resolveExposureCurve([
    {
      ev: 0,
      compensation: 0,
      interpolation: 'cubic',
      tangentMode: 'user',
      weightMode: 'both',
      leaveWeight: 5,
    },
    { ev: 10, compensation: 10, tangentMode: 'user', weightMode: 'both', arriveWeight: 5 },
  ])
  const time = (t: number) => 1.5 * t * (1 - t) + t ** 3
  let low = 0
  let high = 1
  for (let i = 0; i < 80; i++)
    if (time((low + high) / 2) < 0.25) low = (low + high) / 2
    else high = (low + high) / 2
  const t = (low + high) / 2
  near(exposureCurveAt(weighted, 2.5), 3 * (1 - t) * t * t * 10 + t ** 3 * 10)
})

test('an exposure curve goes on outside its keys by its extrapolation', () => {
  const keys = [
    [0, 0],
    [10, 10],
  ] as const
  const outside = (before: never, after: never) => resolveExposureCurve({ keys, before, after })
  const at = (extrapolation: string, ev: number) =>
    exposureCurveAt(outside(extrapolation as never, extrapolation as never), ev)
  assert.equal(exposureCurveAt(resolveExposureCurve(keys), 15), 10) // held by default
  assert.equal(exposureCurveAt(resolveExposureCurve(keys), -5), 0)
  assert.equal(at('linear', 15), 15)
  assert.equal(at('linear', -5), -5)
  // Cycle: 15 is 5 one cycle on, 25 is 5 two on, -2 is 8 one cycle back; none reads as a cycle.
  assert.equal(at('cycle', 15), 5)
  assert.equal(at('cycle', 25), 5)
  assert.equal(at('cycle', 12), 2)
  assert.equal(at('cycle', -2), 8)
  assert.equal(at('none', 15), 5)
  // Cycle with offset: the cycle plus the keys' rise (10) a cycle.
  assert.equal(at('cycleWithOffset', 15), 15)
  assert.equal(at('cycleWithOffset', 25), 25)
  assert.equal(at('cycleWithOffset', -2), -2)
  // Oscillate: odd cycles run back; 12 is 2 in one cycle: 0 + (10 - 2) = 8; 22 is two cycles: 2;
  // -2 is 8 one cycle back, run back: 2.
  assert.equal(at('oscillate', 12), 8)
  assert.equal(at('oscillate', 22), 2)
  assert.equal(at('oscillate', -2), 2)
  assert.throws(
    () => resolveExposureCurve({ keys, after: 'spin' as never }),
    /after must be one of/,
  )
})

/** The sun's shadow settings a quality preset resolves to: the shadows group's level over the
 *  defaults. */
