import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { CATMULL_ROM_TAPS_WGSL, HISTORY_LAWS } from './historyWgsl.ts'
import { REACTIVE_TARGET } from '../../lighting/deferred/asIsShare.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createTaaFrameState } from './frameState.ts'
import { writeTaaView } from './view.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'
import { AS_IS_SHARE_SHADER } from '../../lighting/deferred/asIsShareWgsl.ts'
import { blendTargets } from '../../blend/blendTargets.ts'
import { particleTargets } from '../../particles/particleTargets.ts'
import { PARTICLE_DRAW_WGSL } from '../../particles/gpu/particlesWgsl.ts'
import { TAA_VIEW } from './bindingsWgsl.ts'

const T = TAA_VIEW.at

type Taps = { uv: number[][]; weight: number[] }
const { catmullRomTaps } = shaderRun<{
  catmullRomTaps: (uv: number[], size: number[], inv: number[]) => Taps
}>(CATMULL_ROM_TAPS_WGSL, ['catmullRomTaps'], {})
const SIZE = [16, 8]
const INV = SIZE.map((s) => 1 / s)

test('the five-tap Catmull-Rom weighs one in all, and a texel centre is read as itself', () => {
  for (const uv of [
    [0.3, 0.7],
    [5.2 / 16, 3.9 / 8],
    [0.01, 0.99],
  ]) {
    const { weight } = catmullRomTaps(uv, SIZE, INV)
    assert.ok(Math.abs(weight.reduce((a, b) => a + b, 0) - 1) < 1e-6, `${uv}`)
  }
  const centre = [5.5 / 16, 2.5 / 8]
  const { uv, weight } = catmullRomTaps(centre, SIZE, INV)
  assert.deepEqual(weight, [0, 0, 1, 0, 0])
  assert.ok(
    uv[2].every((v, i) => Math.abs(v - centre[i]) < 1e-9),
    `${uv[2]}`,
  )
})

test('blends and particles write their coverage as the reactive value, seeded 0', () => {
  // The seed: the as-is share in red, a reactive value of 0 in green.
  assert.match(AS_IS_SHARE_SHADER, /return vec2f\(f32\(.*\),0\.0\);/)
  // A blend writes 1 in green at its coverage, over what the pixel holds.
  assert.match(BLEND_SHADER, /s\.request,vec4f\(0\.0,1\.0,0\.0,alpha\*r\.keep\),/)
  // The share's slot follows the request's, empty without feedback.
  const share = blendTargets('normal', 0xf, false)[2]!
  assert.equal(share.format, 'rg8unorm')
  assert.equal(share.blend?.color.srcFactor, 'src-alpha')
  assert.equal(share.blend?.color.dstFactor, 'one-minus-src-alpha')
  // A particle too, the as-is share untouched: green alone.
  assert.match(PARTICLE_DRAW_WGSL, /return Lit\(c, vec4f\(0, 1, 0, c\.a\)\);/)
  assert.equal(REACTIVE_TARGET.writeMask, 0x2)
  assert.equal(REACTIVE_TARGET.blend, share.blend)
  for (const routed of [false, true])
    for (const blend of ['additive', 'premultiplied'] as const)
      assert.equal(particleTargets(blend, routed).at(-1), REACTIVE_TARGET)
})

test('the uniform carries the parallax, the flicker rates, the blend factor and the depth terms', () => {
  const { device, writes } = fakeDevice(),
    state = createTaaFrameState()
  // Last image: the identity view at the eye (1, 2, 3); this one: the eye moved by (0.5, 0, 0).
  state.previousViewProjection.set(IDENTITY_MATRIX4)
  state.previousEye.set([1, 2, 3])
  state.stochasticSample = 13
  const projection = new Float64Array(16)
  projection[0] = 2
  projection[11] = -1
  projection[14] = 0.1
  const cam = {
    viewProjection: IDENTITY_MATRIX4,
    eye: [1.5, 2, 3],
    projection,
  } as unknown as EngineCamera
  writeTaaView(device, {} as GPUBuffer, state, cam, [960, 540], [1920, 1080], [960, 540], false)
  const u = writes.at(-1)!.data as Float32Array
  // `previous · (lastEye − eye, 0)`: the identity's image of (−0.5, 0, 0, 0).
  assert.deepEqual([...u.subarray(T.parallax, T.parallax + 4)], [-0.5, 0, 0, 0])
  assert.ok(Math.abs(u[T.exposure + 2] - (1 - 0.95 ** 2)) < 1e-7, 'two images a period: 1 − 0.95²')
  assert.ok(Math.abs(u[T.exposure + 3] - (1 - 0.95 ** 6)) < 1e-7, 'thin geometry: three periods')
  assert.ok(Math.abs(u[T.rates] - 1 / 5) < 1e-7, 'ten 1080p pixels at 60 Hz: five of 960')
  assert.ok(Math.abs(u[T.rates + 1] - 1 / (1 + 16 / 0.25)) < 1e-7, 'half the display: 1 / 65')
  assert.deepEqual(
    [...u.subarray(T.depth, T.depth + 4)].map((v) => Math.fround(v)),
    [0, Math.fround(0.1), -1, 0],
  )
  assert.ok(Math.abs(u[T.radius] - 1 / (2 * 960)) < 1e-9, 'a render pixel radius per unit depth')
  assert.equal(u[T.radius + 2], -1, 'the view looks down its negative axis')
  assert.equal(u[T.params], 1, 'no history yet: a cut')
  assert.equal(u[T.jitter + 3], 13 % 8, 'the image rank among eight')
})

test('the display history holds 16 samples a pixel: an image weighs one, a rejection keeps two, motion four', () => {
  assert.deepEqual(HISTORY_LAWS, {
    samples: 16,
    hysteresis: 1 / 16,
    rejectedDrop: 1 - 2 / 16,
    movingDrop: 1 - 4 / 16,
    speedInverse: 1,
  })
})
