// A local light's mask value is its ray fraction as traced, k of n rays, in its own lane, decoded
// to the half float its own channel held (`projectionMaskCode.test.ts`). Develop took a
// one-pass packing: a dither of one fifteenth, then a rounding to k/15 that four lights share a
// 16-bit word with — here a lane
// holds the count, not a rounding, and the dither only hid that rounding's bands.
// Against the exact fraction, over every fraction the traces reach (n ≤ 7 rays) and every
// blue-noise texel (j / 255), develop's value in f32 then f16 against the shipped one: the shipped
// value is the half float nearest the fraction, a frame's error is never larger and mostly far
// smaller, and the mean over the noise — what the temporal accumulation converges to — is never
// further by more than a half float's step.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmProjectionWgsl } from './projectionWgsl.ts'
import { vsmLayout } from './layout.ts'

const f = Math.fround
const CODE = vsmProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27), {
  subgroups: false,
})
/** An rgba16float channel's value: the nearest half float. */
const half = (x: number) => {
  if (x === 0) return 0
  const step = 2 ** (Math.max(Math.floor(Math.log2(Math.abs(x))), -14) - 10)
  return Math.round(x / step) * step
}
/** Develop's value of fraction `s` under blue-noise texel `noise`: dithered, then k/15. */
const develop = (s: number, noise: number) => {
  const scale = f(1 / 15)
  let x = s
  if (s > f(scale / 4) && s < 1) x = Math.min(Math.max(f(s + f(f(noise - 0.5) * scale)), 0), 1)
  return half(f((Math.round(f(x * 15)) & 15) / 15))
}

test('the mask stores the ray fraction as traced: no dither, no fifteenths', () => {
  assert.match(CODE, /word\|=vsmMaskCode\(r\)<<\(8u\*lane\);/)
  // No fifteenths: no rounding of a fraction times 15, nor its dither.
  assert.doesNotMatch(CODE, /\*15\.0|15\.0\*|noiseScale|vsmFilterShadowFactor/)
})

test('every reachable ray fraction is stored as close or closer, each frame and on average', () => {
  let worstDevelop = 0,
    worstShipped = 0
  for (let n = 1; n <= 7; n++)
    for (let k = 0; k <= n; k++) {
      const x = k / n,
        shipped = half(f(k) / f(n))
      let squares = 0,
        mean = 0
      for (let j = 0; j < 256; j++) {
        const value = develop(f(f(k) / f(n)), f(j / 255))
        squares += (value - x) ** 2
        mean += value / 256
        worstDevelop = Math.max(worstDevelop, Math.abs(value - x))
      }
      const error = Math.abs(shipped - x)
      worstShipped = Math.max(worstShipped, error)
      assert.ok(error <= Math.sqrt(squares / 256), `${k}/${n}: a frame ${error}`)
      // The nearest value the channel holds; develop's mean, where nearer, is so by less than a
      // half float's step (it averages two neighbouring fifteenths).
      assert.equal(shipped, half(x), `${k}/${n}`)
      assert.ok(
        error <= Math.abs(mean - x) + 2 ** -12,
        `${k}/${n}: mean ${shipped} against ${mean}`,
      )
    }
  assert.ok(worstShipped < 2.5e-4 && worstDevelop > 0.06, `${worstShipped} against ${worstDevelop}`)
})
