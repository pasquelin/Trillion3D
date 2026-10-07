import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { CATMULL_ROM_WGSL, CURRENT_SHARE_WGSL, HISTORY_CAP_WGSL } from './historyWgsl.ts'
import { REACTIVE_TARGET } from '../lighting/deferred/asIsShare.ts'
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createTaaFrameState } from './frameState.ts'
import { writeTaaView } from './view.ts'
import type { EngineCamera } from '../camera/world.ts'
import { BLEND_SHADER } from '../gpu/core/shaderTexts.fixture.ts'
import { AS_IS_SHARE_SHADER } from '../lighting/deferred/asIsShareWgsl.ts'
import { REACTIVE_MAX } from './reactive.ts'
import { blendTargets } from '../webgpu/blend/blendTargets.ts'
import { particleTargets } from '../particles/particleTargets.ts'
import { upscaleRun, type UpscaleFrame } from './upscaleRun.fixture.ts'
import { AS_IS_FLAG } from '../scene/surfaceModel.ts'
import { PARTICLE_DRAW_WGSL } from '../webgpu/particles/particlesWgsl.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

type Share = { currentShare: (a: number, reach: number, rho: number, fresh: boolean) => number }
const { currentShare } = shaderRun<Share>(wgslSource(CURRENT_SHARE_WGSL), ['currentShare'], {})
const MOVING = 1 / 8

test('a pixel with no history takes the current sample whole', () => {
  for (const [reach, rho] of [
    [1, 0],
    [0, 0],
    [0.3, 0.95],
  ])
    assert.equal(currentShare(MOVING, reach, rho, true), 1, `reach ${reach}, reactive ${rho}`)
})

test('a reactive value raises the current share to at least itself, never above 0.9', () => {
  assert.equal(REACTIVE_MAX, 0.9)
  assert.equal(currentShare(MOVING, 1, 0, false), MOVING, 'no reactive: today’s share')
  assert.equal(currentShare(MOVING, 1, 0.05, false), MOVING, 'below the share: nothing')
  for (const rho of [0.3, 0.5, 0.9]) assert.equal(currentShare(MOVING, 1, rho, false), rho)
  for (const rho of [0.95, 1]) assert.equal(currentShare(MOVING, 1, rho, false), REACTIVE_MAX)
  assert.equal(currentShare(MOVING, 0, 0.4, false), 0.4, 'even for a far sample')
})

test('a sample far from its display pixel lowers its weight', () => {
  const shares = [1, 0.6, 0.2, 0].map((reach) => currentShare(MOVING, reach, 0, false))
  assert.deepEqual(shares, [MOVING, MOVING * 0.6, MOVING * 0.2, 0])
})

type Cap = { historyCap: (uv: number[], coord: number[], now: number, kept: number) => number }
const { historyCap } = shaderRun<Cap>(wgslSource(HISTORY_CAP_WGSL), ['historyCap'], {
  view: { viewport: [64, 64, 1 / 64, 1 / 64] },
})
/** The history read `pixels` away along x from display pixel 10,10. */
const away = (pixels: number) => [(10.5 + pixels) / 64, 10.5 / 64]

test('a moving history keeps four samples beside the current one at a pixel a frame', () => {
  assert.ok(historyCap(away(0), [10, 10], 0.5, 0.5) >= 16, 'still: the full sixteen')
  assert.equal(historyCap(away(1), [10, 10], 0.5, 0.5), 5, 'a display pixel a frame: 4 + 1')
  assert.equal(historyCap(away(3), [10, 10], 0.5, 0.5), 5, 'faster: no fewer')
  assert.equal(historyCap(away(0.5), [10, 10], 0.5, 0.5), 11, 'linear below: 10 + 1 at half')
  // A high-contrast edge keeps that share of the full history: |dL| / max(L).
  assert.ok(Math.abs(historyCap(away(1), [10, 10], 1, 0.2) - (1 + 16 * 0.8)) < 1e-9)
  assert.equal(historyCap(away(1), [10, 10], 0, 0), 5, 'black: no contrast')
})

/** A history of 8×8 texels read bilinearly, clamped to its edge: a step from 0 to 1 at column 4,
 *  every row the same. */
const step = (x: number) => (x < 4 ? 0 : 1)
function bilinear([u]: number[]) {
  const x = clamp(u * 8 - 0.5, 0, 7)
  const x0 = Math.floor(x),
    fx = x - x0
  const value = step(x0) * (1 - fx) + step(Math.min(x0 + 1, 7)) * fx
  return [value, value, value, 1]
}
/** A row's centre: the vertical taps land on it. */
const ROW = 4.5 / 8
type Read = { historyCatmullRom: (uv: number[]) => number[] }
const { historyCatmullRom } = shaderRun<Read>(wgslSource(CATMULL_ROM_WGSL), ['historyCatmullRom'], {
  view: { viewport: [8, 8, 1 / 8, 1 / 8] },
  history: null,
  historySampler: null,
  textureSampleLevel: (_: null, __: null, uv: number[]) => bilinear(uv),
})

test('the moving history keeps its sharpness where bilinear softens it', () => {
  // At a texel centre both read the texel itself.
  for (const x of [2, 3, 4, 5]) {
    const uv = [(x + 0.5) / 8, ROW]
    assert.ok(Math.abs(historyCatmullRom(uv)[0] - step(x)) < 1e-9, `texel ${x}`)
  }
  // A quarter of a pixel past the last dark texel: bilinear lets a quarter of the edge in,
  // Catmull-Rom about a fifth — the step stays a step instead of spreading by a fraction each image.
  const uv = [3.75 / 8, ROW],
    soft = bilinear(uv)[0],
    sharp = historyCatmullRom(uv)[0]
  assert.equal(soft, 0.25)
  assert.ok(Math.abs(sharp - 0.203125) < 1e-9, `Catmull-Rom ${sharp}`)
  // Never below zero, whatever its negative lobes.
  assert.ok(historyCatmullRom([4.2 / 8, 0.3]).every((c) => c >= 0 && c <= 1.1))
})

test('blends and particles write their coverage as the reactive value, seeded 0', () => {
  // The seed: the as-is share in red, a reactive value of 0 in green.
  assert.match(AS_IS_SHARE_SHADER, /return vec2f\(f32\(.*\),0\.0\);/)
  // A blend writes 1 in green at its coverage, over what the pixel holds.
  assert.match(BLEND_SHADER, /s\.request,vec4f\(0\.0,1\.0,0\.0,s\.alpha\*r\.keep\),/)
  const share = blendTargets('normal', 0xf, false)[1]!
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

test('the uniform tells the resolve whether the image moves: at rest, today’s resolve', () => {
  const { device, writes } = fakeDevice(),
    state = createTaaFrameState(),
    cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera
  const moves = (stillFrames: number) => {
    state.stillFrames = stillFrames
    writeTaaView(device, {} as GPUBuffer, state, cam, [8, 8], [16, 16], false)
    return (writes.at(-1)!.data as Float32Array)[58]
  }
  assert.deepEqual([0, 1, 5].map(moves), [1, 0, 0])
})

test('the uniform carries the camera parallax, the flicker rates and a pixel width', () => {
  const { device, writes } = fakeDevice(),
    state = createTaaFrameState()
  // Last image: the identity view at the eye (1, 2, 3); this one: the eye moved by (0.5, 0, 0).
  state.previousViewProjection.set(IDENTITY_MATRIX4)
  state.previousEye.set([1, 2, 3])
  state.stochasticSample = 13
  const projection = new Float64Array(16)
  projection[0] = 2
  const cam = {
    viewProjection: IDENTITY_MATRIX4,
    eye: [1.5, 2, 3],
    projection,
  } as unknown as EngineCamera
  const written = () => {
    writeTaaView(device, {} as GPUBuffer, state, cam, [960, 540], [1920, 1080], false)
    return writes.at(-1)!.data as Float32Array
  }
  const u = written()
  // `previous · (lastEye − eye, 0)`: the identity's image of (−0.5, 0, 0, 0).
  assert.deepEqual([...u.subarray(68, 72)], [-0.5, 0, 0, 0])
  assert.ok(Math.abs(u[72] - (1 - 0.95 ** 2)) < 1e-7, 'two images a period: 1 − 0.95²')
  assert.ok(Math.abs(u[73] - 1 / 5) < 1e-7, 'five 1080p pixels an image, whatever the frame rate')
  assert.ok(Math.abs(u[74] - 2 / (2 * 960)) < 1e-9, 'a render pixel at clip w one')
  assert.equal(u[59], 13 % 8, 'the image rank among eight')
})

// A 3×3 of one as-is share clamps any history to it: the share target is sampled for it only where
// its box spans two values, or where a still average below the display needs the weight it holds.
test('an as-is share whose box is one value reads no share history but a still weight', () => {
  // The point texel (the tag) is read; the bilinear sample at the point, never.
  const tags = (p: number[]) => {
    if (p.every(Number.isInteger)) return [0, 0.5, 0, 0.6]
    throw new Error('the as-is share history sampled')
  }
  const color = () => [0.3, 0.3, 0.3, 1]
  const cases = [
    [false, AS_IS_FLAG, 1],
    [false, 1, 0],
    [true, 0.25, 0.25],
  ] as const
  for (const [blended, flag, share] of cases)
    for (const [native, moving] of [
      [true, false],
      [true, true],
      [false, true],
    ]) {
      const size = native ? 6 : 4
      const frame: UpscaleFrame = {
        render: [size, size],
        display: [6, 6],
        moving,
        color,
        history: color,
        tags,
        id: () => 256,
        depth: () => 0.4,
        historyGeometry: () => [1, 0.4],
        flag: () => flag,
      }
      const resolved = upscaleRun(frame, true, false, native, { blended })(2, 3)
      // Within the uniform's 32-bit weights, whose sum is 1 to 1e-8.
      assert.ok(Math.abs(resolved.share - share) < 1e-6, `${blended} ${native} ${moving}`)
    }
})
