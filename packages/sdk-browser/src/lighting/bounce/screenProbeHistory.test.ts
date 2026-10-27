// The screen probes' history and light: a history texel's validity, a pixel's motion, and the occlusions the light goes under.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { spHistory } from './screen/historyWgsl.ts'
import { SCREEN_INDIRECT_WGSL } from './screen/indirectWgsl.ts'
import { spVectors } from './screen/vectorsWgsl.ts'
import { SCREEN_PROBE_FLAGS } from './screen/screenProbeLayout.ts'

/** The history of a 64 by 64 image run on the shipped text, seen at a perspective whose device depth is `A + B / w` (`slab` `[1, A, B, 1]`, the
 *  view-projection adding `A + B` to the clip depth): `set` the linear depths the four texels round its centre kept, `mark` which of them
 *  light their backface, `reproject` the pixel at the centre over the point at the origin. */
function historyOf(A = 0) {
  const B = 0.1
  const identity = builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, A + B, 1)
  const depths = new Map<string, number>()
  const backfaces = new Map<string, boolean>()
  const texels = [
    [31, 31],
    [32, 31],
    [31, 32],
    [32, 32],
  ]
  const depthIn = {},
    shadingIn = {}
  const run = shaderRun<{
    spReproject: (
      pixel: number[],
      P: number[],
      N: number[],
      backface: boolean,
      noise: number,
    ) => { texel: number[]; weights: number[]; codes: number[] }
    spShadingPack: (N: number[], hair: boolean, backface: boolean) => number
  }>(wgslModule(spCommon([4, 2]), spHistory(7, 9, 8)), ['spReproject', 'spShadingPack'], {
    sp: {
      size: [64, 64, 16, 0],
      counts: [10, 0, 0, 0],
      mode: [0, 0, SCREEN_PROBE_FLAGS.temporal, 0],
      scene: [0, 0.01, 0, 0.03],
      motion: [0.005, 10, 0.9, 0],
    },
    reflectionView: { radianceViewProj: identity, radiance: [64, 64, 0, 0], slab: [1, A, B, 1] },
    depthIn,
    shadingIn,
    viewToEye: () => [0, 0, 1],
    textureLoad: (texture: unknown, texel: number[]) => {
      const at = String(texel)
      // A texel the test sets no depth keeps none: a device depth of zero.
      if (texture === depthIn) return [depths.has(at) ? A + B / depths.get(at)! : 0, 0, 0, 0]
      return [run.spShadingPack([0, 0, 1], false, backfaces.get(at) ?? false), 0x2b, 0, 0]
    },
  })
  return {
    set: (values: number[]) => texels.forEach((t, i) => depths.set(String(t), values[i])),
    mark: (values: boolean[]) => texels.forEach((t, i) => backfaces.set(String(t), values[i])),
    reproject: (N: number[], noise: number, backface = false) =>
      run.spReproject([32, 32], [0, 0, 0], N, backface, noise),
  }
}

test("a history texel counts where its depth is the expected one within a threshold the noise and the surface's slope move", () => {
  const { set, reproject } = historyOf()
  const weights = (N: number[], noise: number) => reproject(N, noise).weights
  set([1, 1, 1.08, 1])
  assert.deepEqual(
    weights([0, 0, 1], 0.5),
    [0.25, 0.25, 0, 0.25],
    'a tap on another surface is nothing',
  )
  assert.deepEqual(
    weights([1, 0, 0], 0.5),
    [0.25, 0.25, 0.25, 0.25],
    'a grazing surface lets its threshold grow tenfold',
  )
  set([1, 1.008, 1, 1])
  assert.equal(weights([0, 0, 1], 0)[1], 0, 'the noise narrows the threshold to a half')
  assert.equal(weights([0, 0, 1], 1)[1], 0.25, 'and widens it by a half')
  const kept = reproject([0, 0, 1], 0.5)
  assert.deepEqual(
    kept.codes,
    [0x2b, 0x2b, 0x2b, 0x2b],
    'the frames code of a texel comes with its weight',
  )
  assert.deepEqual(
    historyOf().reproject([0, 0, 1], 0.5).weights,
    [0, 0, 0, 0],
    'a texel that kept no surface (a device depth of zero) is nothing',
  )
  // A view whose far end is finite gives the device depth zero a depth of its own: still nothing.
  assert.deepEqual(
    historyOf(-0.1).reproject([0, 0, 1], 0.5).weights,
    [0, 0, 0, 0],
    'even where the zero depth is the far plane’s',
  )
})

test('a pixel that lights its backface takes the history of such pixels alone, within a wider threshold', () => {
  const { set, mark, reproject } = historyOf()
  // A depth 2 % off: past the threshold (1 %) of a solid surface, within a foliage pixel's (3 %).
  set([1, 1.02, 1, 1.02])
  const sheet = (backface: boolean, flags: boolean[]) => {
    mark(flags)
    return reproject([0, 0, 1], 0.5, backface).weights
  }
  assert.deepEqual(
    sheet(true, [true, true, true, true]),
    [0.25, 0.25, 0.25, 0.25],
    'foliage keeps more',
  )
  assert.deepEqual(
    sheet(false, [false, false, false, false]),
    [0.25, 0, 0.25, 0],
    'a solid surface keeps less',
  )
  assert.deepEqual(
    sheet(true, [true, false, true, false]),
    [0.25, 0, 0.25, 0],
    'a texel of another kind is nothing, whatever its depth',
  )
  assert.deepEqual(
    sheet(false, [true, true, false, false]),
    [0, 0, 0.25, 0],
    'and a solid surface does not take a sheet’s',
  )
  set([1, 1.04, 1, 1])
  assert.equal(sheet(true, [true, true, true, true])[1], 0, 'past the wider threshold too')
})

test('a pixel the camera alone moves keeps its exact reprojection and no speed, a dynamic one the vector it names, however small', () => {
  const identity = builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  let vector = [0, 0]
  let own = false
  const { encodeOwnVector, spMotionOf } = shaderRun<{
    encodeOwnVector: (v: number[], own: boolean) => number
    spMotionOf: (pixel: number[], P: number[], camera: number[]) => { ndc: number[]; speed: number }
  }>(wgslModule(spCommon([4, 2]), spVectors(9)), ['encodeOwnVector', 'spMotionOf'], {
    sp: {
      size: [64, 64, 16, 0],
      mode: [0, 0, SCREEN_PROBE_FLAGS.velocity, 0],
      motion: [0.005, 10, 0.9, 0],
      previous: identity,
    },
    reflectionView: { radianceViewProj: identity, viewProj: identity, slab: [1, 0, 0, 1] },
    view: { camera: [0, 0, 10, 1] },
    sceneVectors: {},
    textureLoad: () => [encodeOwnVector(vector, own), 0, 0, 0],
  })
  // The pixel (32, 32) shows the point whose device position the identity view-projection gives.
  const pixel = [32, 32],
    here = 32.5 / 32 - 1,
    P = [here, -here, 0.5],
    camera = [here, -here]
  const near = (a: number[], b: number[], within: number) =>
    a.every((v, i) => Math.abs(v - b[i]) <= within)
  vector = [0.1, 0]
  const still = spMotionOf(pixel, P, camera)
  assert.equal(still.speed, 0, 'not dynamic: no velocity')
  assert.deepEqual(still.ndc, camera, 'and its camera reprojection, whatever the vector holds')
  own = true
  const moved = spMotionOf(pixel, P, camera)
  assert.ok(Math.abs(moved.speed - 0.1) < 2e-3, `a surface that moved: ${moved.speed}`)
  assert.ok(near(moved.ndc, [here - 0.1, -here], 2e-3), 'its vector')
  vector = [0.0002, 0]
  const slow = spMotionOf(pixel, P, camera)
  assert.ok(
    near(slow.ndc, [here - 0.0002, -here], 5e-4),
    'a dynamic pixel takes its vector at any speed',
  )
  assert.ok(!near(slow.ndc, camera, 1e-5), 'not the camera’s reprojection')
})

test('the probes’ light goes under the material’s occlusion through the albedo’s multi-bounce, then under the short-range occlusion at its strength; their occlusion alone goes over the world’s light', () => {
  type Seen = [number, number, number, number]
  const lit = shaderRun<{
    screenDiffuse: (rgb: number[], metal: number, seen: Seen, ao: number) => number[]
    screenLights: (seen: Seen) => boolean
    screenShortRange: (rgb: number[], metal: number, seen: Seen) => number[]
    lambertDiffuse: (rgb: number[], metal: number, irradiance: number[], ao: number) => number[]
  }>(
    wgslModule(SCREEN_INDIRECT_WGSL),
    ['screenDiffuse', 'screenLights', 'screenShortRange', 'lambertDiffuse'],
    { view: { screenProbes: [1, 0.5, 1, 0] }, screenIndirect: {}, textureLoad: () => [0, 0, 0, 0] },
  )
  const multi = (albedo: number[], ao: number) =>
    albedo.map((a) =>
      Math.max(
        ao,
        ((ao * (2.0404 * a - 0.3324) + (-4.7951 * a + 0.6417)) * ao + (2.7552 * a + 0.6903)) * ao,
      ),
    )
  const rgb = [0.8, 0.4, 0.2],
    seen: Seen = [2, 1, 0.5, 0.4],
    ao = 0.6
  const capped = rgb.map((v) => Math.min(v, 0.5))
  const base = lit.lambertDiffuse(rgb, 0, [2, 1, 0.5], 1)
  const factor = (made: number[]) => made.map((v, i) => v / base[i])
  const material = multi(capped, ao),
    occlusion = multi(capped, 0.4)
  const near3 = (actual: number[], expected: number[], label: string) =>
    expected.forEach((v, i) => nearRelative(actual[i], v, label, 1e-5))
  near3(
    factor(lit.screenDiffuse(rgb, 0, seen, ao)),
    material.map((v, i) => v * occlusion[i]),
    'the material’s multi-bounce, then the occlusion’s',
  )
  assert.ok(lit.screenLights(seen), 'mode 0: the probes’ light')
  assert.deepEqual(lit.screenShortRange(rgb, 0, seen), [1, 1, 1], 'nothing over the world’s light')
  // The material's occlusion off: the light is under the short-range occlusion alone, and a strength of a half takes half of it.
  const off = shaderRun<typeof lit>(
    wgslModule(SCREEN_INDIRECT_WGSL),
    ['screenDiffuse', 'screenLights', 'screenShortRange', 'lambertDiffuse'],
    {
      view: { screenProbes: [0, 0.5, 0.5, 1] },
      screenIndirect: {},
      textureLoad: () => [0, 0, 0, 0],
    },
  )
  near3(
    factor(off.screenDiffuse(rgb, 0, seen, ao)),
    occlusion.map((v) => 1 + (v - 1) * 0.5),
    'the strength is taken after the multi-bounce',
  )
  assert.ok(!off.screenLights(seen), 'mode 1: the probes’ occlusion alone')
  near3(
    off.screenShortRange(rgb, 0, seen),
    occlusion.map((v) => 1 + (v - 1) * 0.5),
    'over the world’s light',
  )
  assert.deepEqual(
    off.screenShortRange(rgb, 0, [2, 1, 0.5, 0]),
    [1, 1, 1],
    'none where they left none',
  )
})
