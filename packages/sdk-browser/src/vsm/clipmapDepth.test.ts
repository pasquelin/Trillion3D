// A clipmap sample's depth (`vsmReadClipmapPage`, `vsmClipmapTexelDepth`) multiplies by the inverse of its level's depth
// scale instead of dividing by it. The scale is 2^-k (`vsmLevelToLevelOf`), k the
// level offset, so its inverse 2^k is exact, and x / 2^-k and x · 2^k are the same correctly
// rounded number — the exact one, short of overflow, where both are infinite. On the sample's own
// level the depth was (raw − 0) / 1: it is (raw − 0) · 1, raw itself. Run in f32 over raw depths and
// biases of every exponent the reversed-Z depth reaches, signed zeros among them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionText } from '../bounce/wgslBody.fixture.ts'
import { VSM_PROJECTION_SAMPLE_WGSL } from './projectionDataWgsl.ts'

const f = Math.fround

test('the shipped reads multiply by the exact inverse of the level scale', () => {
  const code = VSM_PROJECTION_SAMPLE_WGSL
  const transform = functionText(code, 'vsmLevelToLevelOf')
  assert.match(
    transform,
    /r\.scale=select\(f32\(1u<<u32\(-levelOffset\)\),1\.0\/f32\(1u<<u32\(levelOffset\)\),levelOffset>=0\);/,
  )
  // Its inverse, carried to every read that takes a depth to a level (the filtered taps and the
  // transmission too): 1 / f32(2^m) for a scale 2^m, 2^k for a scale 1 / f32(2^k).
  assert.match(
    transform,
    /r\.depthInverse=select\(1\.0\/f32\(1u<<u32\(-levelOffset\)\),f32\(1u<<u32\(levelOffset\)\),levelOffset>=0\);/,
  )
  for (let k = -24; k <= 24; k++) {
    const scale = k < 0 ? f(2 ** -k) : f(1 / f(2 ** k)),
      inverse = k < 0 ? f(1 / f(2 ** -k)) : f(2 ** k)
    assert.equal(f(scale * inverse), 1, `offset ${k}`)
    assert.equal(f(1 / scale), inverse, `offset ${k}`)
  }
  // The texel's level (`vsmClipmapTexel`) carries the inverse, its read multiplies by it.
  const texel = functionText(code, 'vsmClipmapTexel')
  assert.match(texel, /if\(levelGap>0u\)\{[^}]*r\.depthLevelInverse=t\.depthInverse;/)
  assert.match(
    functionText(code, 'vsmClipmapTexelDepth'),
    /return \(raw-t\.depthLevelBias\)\*t\.depthLevelInverse;/,
  )
  assert.match(
    functionText(code, 'vsmReadClipmapPage'),
    /r\.depth=vsmClipmapTexelDepth\(t,vsmPoolDepth\(t\.poolTexel\)\);/,
  )
  // `vsmLevelToLevelOf` is called with the same positive offset.
  assert.match(texel, /vsmLevelToLevelOf\(h,i32\(levelGap\)\)/)
})

test('in f32, (raw − bias) / 2^-k is (raw − bias) · 2^k, and (raw − 0) / 1 is raw', () => {
  let seed = 1563
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
  const word = new Float32Array(1),
    bits = new Uint32Array(word.buffer)
  const values = [0, -0, 1, 2 ** -24, 2 ** -126, 0.5]
  for (let i = 0; i < 200_000; i++) {
    bits[0] = Math.floor(next() * 2 ** 32)
    if (Number.isFinite(word[0])) values.push(word[0])
  }
  let checked = 0
  for (const raw of values) {
    const own = f(f(raw - 0) / 1)
    assert.ok(Object.is(f(f(raw - 0) * 1), own) && Object.is(own, raw), `raw ${raw}`)
    for (let k = 1; k <= 24; k++) {
      const bias = values[(checked * 7 + k) % values.length]
      const x = f(raw - bias)
      const scale = f(1 / f(2 ** k))
      assert.ok(Object.is(f(x * f(2 ** k)), f(x / scale)), `raw ${raw} bias ${bias} k ${k}`)
      checked++
    }
  }
  assert.ok(checked > 4e6, `${checked} cases`)
})
