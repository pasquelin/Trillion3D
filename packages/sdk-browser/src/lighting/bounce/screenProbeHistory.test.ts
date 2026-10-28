// The screen probes' history: a history texel's validity and a pixel's motion.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { spHistory } from './screen/historyWgsl.ts'
import { spVectors } from './screen/vectorsWgsl.ts'
import { traceScreenShader } from './screen/traceWgsl.ts'
import { SCREEN_PROBE_FLAGS } from './screen/screenProbeLayout.ts'

/** The history of a 64 by 64 image run on the shipped text, seen at a perspective whose device depth is `A + B / w` (`slab` `[1, A, B, 1]`, the
 *  view-projection adding `A + B` to the clip depth): `set` the linear depths the four texels round its centre kept, `mark` which of them
 *  have backface diffuse light, `reproject` the pixel at the centre over the point at the origin. */
function historyOf(A = 0) {
  const B = 0.1
  const identity = builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, A + B, 1)
  const depths = new Map<string, number>()
  const foliages = new Map<string, boolean>()
  const texels = [
    [31, 31],
    [32, 31],
    [31, 32],
    [32, 32],
  ]
  const shadingIn = {},
    depthIn = {}
  const run = shaderRun<{
    spReproject: (
      pixel: number[],
      P: number[],
      N: number[],
      foliage: boolean,
      noise: number,
    ) => { texel: number[]; weights: number[]; codes: number[] }
    spShadingPack: (N: number[], foliage: boolean) => number
  }>(wgslModule(spCommon([4, 2]), spHistory(9, 10, 8)), ['spReproject', 'spShadingPack'], {
    sp: {
      size: [64, 64, 16, 0],
      counts: [10, 0, 0, 0],
      mode: [0, 0, SCREEN_PROBE_FLAGS.temporal, 0],
      scene: [0, 0.01, 0, 0.03],
      motion: [0.005, 10, 0.9, 0],
    },
    reflectionView: { radianceViewProj: identity, radiance: [64, 64, 0, 0], slab: [1, A, B, 1] },
    shadingIn,
    depthIn,
    viewToEye: () => [0, 0, 1],
    textureLoad: (texture: unknown, texel: number[]) => {
      const at = String(texel)
      // A texel the test sets no depth keeps none: a device depth of zero.
      if (texture === depthIn) return [depths.has(at) ? A + B / depths.get(at)! : 0, 0, 0, 0]
      return [run.spShadingPack([0, 0, 1], foliages.get(at) ?? false), 0x2b, 0, 0]
    },
  })
  return {
    set: (values: number[]) => texels.forEach((t, i) => depths.set(String(t), values[i])),
    mark: (values: boolean[]) => texels.forEach((t, i) => foliages.set(String(t), values[i])),
    put: (texel: number[], depth: number) => depths.set(String(texel), depth),
    reproject: (N: number[], noise: number, foliage = false, P = [0, 0, 0]) =>
      run.spReproject([32, 32], P, N, foliage, noise),
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

test('a point the last image showed at its very edge keeps its edge texel whole: the position is held a guard band inside the texel centres, a point past the edge has no history', () => {
  const { put, reproject } = historyOf()
  put([0, 31], 1)
  put([0, 32], 1)
  // A history position at x = 0.005 of 64, a hundredth of a texel inside the edge: held to the first texel's centre plus the guard band.
  const edge = reproject([0, 0, 1], 0.5, false, [-1 + 0.01 / 64, 0, 0])
  assert.deepEqual(edge.texel, [0, 31])
  assert.ok(edge.weights[0] > 0.49 && edge.weights[2] > 0.49, 'the edge texels keep their weight')
  assert.deepEqual(
    [edge.weights[1], edge.weights[3]],
    [0, 0],
    'the texel past them has under the least weight',
  )
  assert.deepEqual(
    reproject([0, 0, 1], 0.5, false, [-1 - 0.01 / 64, 0, 0]).weights,
    [0, 0, 0, 0],
    'a position past the edge has no history',
  )
})

test('a pixel with backface diffuse light takes the history of such pixels alone, within a wider threshold', () => {
  const { set, mark, reproject } = historyOf()
  // A depth 2 % off: past the threshold (1 %) of a solid surface, within a foliage pixel's (3 %).
  set([1, 1.02, 1, 1.02])
  const sheet = (foliage: boolean, flags: boolean[]) => {
    mark(flags)
    return reproject([0, 0, 1], 0.5, foliage).weights
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

test('the depth the last image kept a point at is the point’s own where its surface did not move by itself, the depth it stood at where it did', () => {
  const view = builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.25, 1)
  const { spStoodClip } = shaderRun<{
    spStoodClip: (motion: object, P: number[], clip: number[]) => number[]
  }>(wgslModule(spCommon([4, 2]), spVectors(9)), ['spStoodClip'], {
    sp: { size: [64, 64, 16, 0] },
    reflectionView: { radianceViewProj: view, viewProj: view, slab: [1, 0, 0, 1] },
    sceneVectors: {},
  })
  const P = [0.2, -0.1, 0.6],
    clip = [0.2, -0.1, 0.55, 1]
  const still = { ndc: [0.2, -0.1], speed: 0, before: P }
  assert.deepEqual(spStoodClip(still, P, clip), clip, 'a still surface stood where it is')
  // A surface that moved stood at z = 1 against its 0.6 now: the last image’s view-projection puts it at the depth that z gives.
  const moved = { ndc: [0.15, -0.1], speed: 0.4, before: [0.2, -0.1, 1.0] }
  const stood = spStoodClip(moved, P, clip)
  assert.ok(Math.abs(stood[2] - 0.75) < 1e-6 && stood[3] === 1, `${stood}`)
  assert.notEqual(stood[2], clip[2], 'not the depth of where it is now')
})

test('the screen trace expects a moving hit at the depth it stood at, as the history of a pixel is read', () => {
  const trace = traceScreenShader(8, [4, 4])
  assert.match(
    trace,
    /let stood=spStoodClip\(motion,hitPoint,expected\);\n if\(stood\.w<=0\.0\)\{return out;\}/,
  )
  assert.match(trace, /return SpHistoryHit\(texel,stood,motion\.speed,vignette>=noise\);/)
  assert.doesNotMatch(trace, /SpHistoryHit\(texel,expected,/)
  const history = wgslModule(spCommon([4, 2]), spHistory(9, 10, 8))
  assert.match(history, /let stood=spStoodClip\(motion,P,clip\);/)
})
