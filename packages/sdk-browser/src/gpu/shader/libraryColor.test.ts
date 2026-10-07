// The colour declarations of the maths library (`packages/math/src/wgsl/color.ts`), their shipped
// text run in JavaScript against the processor's sRGB encode and the bytes they unpack.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { linearToSrgb, luminance, unorm8x3 } from '../../../../math/src/wgsl/color.ts'
import { minChannel } from '../../../../math/src/wgsl/sampling.ts'
import { linearToSrgb as linearToSrgbTs } from '../../../../math/src/color/color.ts'

type V = number[]
const run = shaderRun<{
  unorm8x3: (p: number) => V
  luminance: (c: V) => number
  linearToSrgb: (c: V) => V
  minChannel: (c: V) => number
}>(
  wgslModule(unorm8x3, luminance, linearToSrgb, minChannel),
  ['unorm8x3', 'luminance', 'linearToSrgb', 'minChannel'],
  {},
)

test('three bytes of a word, red first, each over 255; the fourth is ignored', () => {
  assert.deepEqual(run.unorm8x3(0xff804000), [0, 64 / 255, 128 / 255])
  assert.deepEqual(run.unorm8x3(0x00ffffff), [1, 1, 1])
  assert.deepEqual(run.unorm8x3(0x12030201), [1 / 255, 2 / 255, 3 / 255])
})

test('the luminance weighs the linear primaries, white to one', () => {
  assert.ok(Math.abs(run.luminance([1, 1, 1]) - 1) < 1e-7)
  const weights = [run.luminance([1, 0, 0]), run.luminance([0, 1, 0]), run.luminance([0, 0, 1])]
  weights.forEach((w, i) => assert.ok(Math.abs(w - [0.2126, 0.7152, 0.0722][i]) < 1e-8))
})

test('the sRGB encode is the processor one, both branches, a negative linear', () => {
  for (const c of [-0.5, 0, 0.001, 0.0031308, 0.0032, 0.01, 0.18, 0.5, 0.9, 1, 4]) {
    const [r] = run.linearToSrgb([c, c, c])
    // The exponent is the f32 nearest 1/2.4: 2.7e-7 apart on [0, 1] at most.
    assert.ok(Math.abs(r - linearToSrgbTs(c)) <= 3e-7 * Math.max(1, Math.abs(r)), `${c}: ${r}`)
  }
})

test('the least channel', () => {
  assert.equal(run.minChannel([0.3, -2, 5]), -2)
  assert.equal(run.minChannel([4, 3, 9]), 3)
})
