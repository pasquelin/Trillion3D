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

/** The exponent the encode's text writes. */
const EXPONENT = Number(/vec3f\(([\d.]+)\)\)-0\.055/.exec(linearToSrgb.text)?.[1])

test('the exponent literal is the f32 nearest 1/2.4', () => {
  assert.equal(Math.fround(EXPONENT), Math.fround(1 / 2.4))
})

test('the sRGB encode is the processor one, both branches, a negative linear', () => {
  for (const c of [-0.5, 0, 0.001, 0.0031308, 0.0031309, 0.0032, 0.01, 0.18, 0.5, 0.9, 1, 4]) {
    const [r] = run.linearToSrgb([c, c, c])
    // Run in double precision, the text strays from the definition by its exponent alone: the f32
    // literal moves 1.055·C^(1/2.4) by itself times |ln C| times its distance to 1/2.4 (9.7e-9),
    // 2.5e-8 at C = 4 and nothing on the linear branch. Past that, the 2e-9 the encode met before
    // its exponent was the f32: a coefficient or the threshold off in its last digit fails.
    const exponentGap =
      c > 0.0031308 ? 1.055 * c ** (1 / 2.4) * Math.abs(Math.log(c) * (1 / 2.4 - EXPONENT)) : 0
    assert.ok(Math.abs(r - linearToSrgbTs(c)) <= exponentGap + 2e-9, `${c}: ${r}`)
  }
})

test('the least channel', () => {
  assert.equal(run.minChannel([0.3, -2, 5]), -2)
  assert.equal(run.minChannel([4, 3, 9]), 3)
})
