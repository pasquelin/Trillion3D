// The global resolution bias, a plain f32 lerp (`approach`), falls until a step no longer moves it,
// on a subnormal. Under 2^-54 a bias leaves every level the CPU's local mip (f64) and the GPU's
// marking (f32) compute where it was, and the bound is tight.
import { f32Bits, fromF32Bits } from '../../../../../math/src/float/bits.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_PRESSURE_BIAS_NONE, VSM_PRESSURE_CALM_FRAMES, vsmLocalMipLevel } from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'
const F64 = new Float64Array(1),
  B64 = new BigInt64Array(F64.buffer)
/** The double right below `x` (x > 0). */
const below = (x: number) => ((F64[0] = x), (B64[0] -= 1n), F64[0])
/** The largest f32 under 2^-54: the largest bias the bound lets through. */
const G = fromF32Bits(f32Bits(2 ** -54) - 1)

test('after an overload the bias falls to where its f32 step stalls, under 2^-54, and stays there', () => {
  const cache = new VsmCacheManager()
  let bias = 0
  // No page free for 20 frames: up to the limit.
  for (let n = 1; n <= 20; n++) {
    cache.frameStamp = n
    bias = cache.readPoolFeedback(0, bias)
  }
  assert.equal(bias, 2)
  // A quarter of the pool free, below the load: the calm frames hold the bias, then it falls, the
  // bias echoed back, until a step no longer moves it.
  let frame = 20
  const step = () => {
    cache.frameStamp = ++frame
    return (bias = cache.readPoolFeedback(1024, bias))
  }
  for (let n = 0; n < VSM_PRESSURE_CALM_FRAMES; n++) assert.equal(step(), 2, 'the wait holds it')
  for (let last = -1; bias !== last && frame < 2000;) {
    last = bias
    step()
  }
  assert.ok(frame < 2000, `stalled within ${frame} frames`)
  assert.ok(bias > 0 && bias < VSM_PRESSURE_BIAS_NONE, `${bias} is under 2^-54`)
  for (let n = 0; n < 100; n++) {
    cache.frameStamp = ++frame
    assert.equal(cache.readPoolFeedback(1024, 0), bias, 'and it stays there')
  }
})

test('under 2^-54 the bias moves no level on the CPU: the local mip of every double below 1..23', () => {
  // `vsmLocalMipLevel` sums log2(footprint) + the map's bias + the global one in doubles: a
  // footprint of 1 puts the level at the map's bias, every double right below each integer.
  const moved: number[] = []
  for (let n = 1; n <= 23; n++)
    for (let x = n, k = 0; k < 1 << 14; k++) {
      x = below(x)
      if (vsmLocalMipLevel(1, x, G) !== vsmLocalMipLevel(1, x, 0)) moved.push(x)
    }
  assert.deepEqual(moved, [])
  // Tight: 2^-54 is half the step of the doubles below 1, and lifts 1 - 2^-53 to 1.
  assert.equal(vsmLocalMipLevel(1, 1 - 2 ** -53, 2 ** -54), 1)
  assert.equal(vsmLocalMipLevel(1, 1 - 2 ** -53, 0), 0)
})

test('under 2^-54 the bias moves no level on the GPU: the f32 sums of the marking keep their floor', () => {
  // The marking's sums, in f32 and in order (`vsmMarkedLevel`, `vsmLocalMipLevel`):
  // ((level + map bias) + global) + extra, floored; a local mip clamps at 0, and a clipmap's index
  // counts from its first level (0 or more), so a floor of -1 lands where 0 does.
  const level = (s: number, g: number, e: number) =>
    Math.max(Math.floor(Math.fround(Math.fround(s + g) + e)), 0)
  const extras = [0, Math.fround(0.25), Math.fround(1 - 2 ** -24), 1, Math.fround(1.5)]
  // Every f32 in the 2^14 steps on each side of every integer 0..23.
  const moved: number[] = []
  for (let n = 0; n <= 23; n++) {
    const b = f32Bits(n)
    for (let k = -(1 << 14); k <= 1 << 14; k++) {
      if (n === 0 && k < 0) continue
      const s = fromF32Bits(b + k)
      for (const e of extras) if (level(s, G, e) !== level(s, 0, e)) moved.push(s, e)
    }
  }
  assert.deepEqual(moved, [])
  // Elsewhere the sum is left as it is: from 2^-29 up, G is under half the f32 step on either side
  // of a binade's edge; under 2^-29 the sum stays within (-1, 1), floored to -1 or 0.
  for (let e = -29; e <= 4; e++)
    for (const s of [2 ** e, -(2 ** e), fromF32Bits(f32Bits(2 ** (e + 1)) - 1)])
      assert.equal(Math.fround(s + G), s)
  assert.notEqual(Math.fround(-(2 ** -30) + G), -(2 ** -30))
  // In f32 a level keeps its floor up to 2^-25: that lifts 1 - 2^-24 to 1.
  assert.equal(level(Math.fround(1 - 2 ** -24), 2 ** -26, 0), 0)
  assert.equal(level(Math.fround(1 - 2 ** -24), 2 ** -25, 0), 1)
})
