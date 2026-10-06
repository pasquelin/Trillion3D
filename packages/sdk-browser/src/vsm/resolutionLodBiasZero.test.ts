// The global resolution bias falls back to exactly 0 once the pool's fill does: under
// `VSM_PRESSURE_BIAS_FLOOR` it is 0, where its f32 decay alone stops on a
// subnormal for good. The floor moves no level: under 2^-54 a bias leaves every level the CPU's
// local mip (f64) and the GPU's marking (f32) compute where it was, and the bound is tight.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_PRESSURE_BIAS_FLOOR, vsmLocalMipLevel } from './constants.ts'
import { VsmCacheManager } from './cacheManager.ts'

const f = Math.fround
const F32 = new Float32Array(1),
  U32 = new Uint32Array(F32.buffer)
const bitsOf = (x: number) => ((F32[0] = x), U32[0])
const ofBits = (b: number) => ((U32[0] = b >>> 0), F32[0])
const F64 = new Float64Array(1),
  B64 = new BigInt64Array(F64.buffer)
/** The double right below `x` (x > 0). */
const below = (x: number) => ((F64[0] = x), (B64[0] -= 1n), F64[0])
/** The largest f32 under 2^-54: the largest bias the bound lets through. */
const G = ofBits(bitsOf(2 ** -54) - 1)

test('after an overload the bias falls back to exactly 0, its last step at the floor or above', () => {
  const cache = new VsmCacheManager()
  let bias = 0
  // No page free for 20 frames: up to the limit.
  for (let n = 1; n <= 20; n++) {
    cache.frameStamp = n
    bias = cache.readPoolFeedback(0, bias)
  }
  assert.equal(bias, 2)
  // Half the pool free: down a tenth of the gap a frame after the wait, the bias echoed back.
  let frame = 20,
    last = bias
  while (bias > 0 && frame < 2000) {
    cache.frameStamp = ++frame
    last = bias
    bias = cache.readPoolFeedback(1024, bias)
  }
  assert.equal(bias, 0, `0 at frame ${frame}`)
  assert.ok(frame < 500, `within ${frame} frames`)
  assert.ok(last >= VSM_PRESSURE_BIAS_FLOOR, 'the last bias kept')
  assert.ok(f(last + (0 - last) * 0.1) < VSM_PRESSURE_BIAS_FLOOR, 'the next under it')
  // Without the floor, nine tenths of 4·2^-149 round back to it: the decay alone stops there.
  let alone = last
  for (let k = 0; k < 2000; k++) alone = f(alone + (0 - alone) * 0.1)
  assert.equal(alone, 4 * 2 ** -149)
  for (let n = 0; n < 100; n++) {
    cache.frameStamp = ++frame
    assert.equal(cache.readPoolFeedback(1024, 0), 0, 'and it stays there')
  }
  assert.ok(VSM_PRESSURE_BIAS_FLOOR <= 2 ** -56, 'a quarter of the bound')
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
  const level = (s: number, g: number, e: number) => Math.max(Math.floor(f(f(s + g) + e)), 0)
  const extras = [0, f(0.25), f(1 - 2 ** -24), 1, f(1.5)]
  // Every f32 in the 2^14 steps on each side of every integer 0..23.
  const moved: number[] = []
  for (let n = 0; n <= 23; n++) {
    const b = bitsOf(n)
    for (let k = -(1 << 14); k <= 1 << 14; k++) {
      if (n === 0 && k < 0) continue
      const s = ofBits(b + k)
      for (const e of extras) if (level(s, G, e) !== level(s, 0, e)) moved.push(s, e)
    }
  }
  assert.deepEqual(moved, [])
  // Elsewhere the sum is left as it is: from 2^-29 up, G is under half the f32 step on either side
  // of a binade's edge; under 2^-29 the sum stays within (-1, 1), floored to -1 or 0.
  for (let e = -29; e <= 4; e++)
    for (const s of [2 ** e, -(2 ** e), ofBits(bitsOf(2 ** (e + 1)) - 1)]) assert.equal(f(s + G), s)
  assert.notEqual(f(-(2 ** -30) + G), -(2 ** -30))
  // In f32 a level keeps its floor up to 2^-25: that lifts 1 - 2^-24 to 1.
  assert.equal(level(f(1 - 2 ** -24), 2 ** -26, 0), 0)
  assert.equal(level(f(1 - 2 ** -24), 2 ** -25, 0), 1)
})
