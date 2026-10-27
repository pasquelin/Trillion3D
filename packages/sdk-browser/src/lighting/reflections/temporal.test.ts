// The reflections' temporal accumulation: where a pixel's history is read in the last image, by the surface's own
// motion (`temporalOwnMotion`, run in JavaScript by `shaderRun`), whose vectors are read only against the image
// just before and compared without either image's jitter, and the clamp its history is held in.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { FakeBuffer } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { VECTOR_CODEC_WGSL } from '../../post/taa/velocityWgsl.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import { heldImage } from './heldImage.fixture.ts'
import { vectorsReach } from './litImage.ts'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { createReflectionViewWriter } from './viewWrite.ts'

type Vec2 = [number, number]

const SIZE: Vec2 = [64, 32]
const codec = shaderRun<{
  encodeOwnVector: (v: Vec2, own: boolean) => number
  withDepthStep: (word: number, step: number) => number
}>(VECTOR_CODEC_WGSL, ['encodeOwnVector', 'withDepthStep'], {})
/** `temporalOwnMotion` of a pixel whose vector word is `word`, on the surface `layer`, the view-projections
 *  jittered by `jitter` (this image's, then the last's). */
const ownMotion = (word: number, layer = 0, jitter = [0, 0, 0, 0]) =>
  shaderRun<{ temporalOwnMotion: (coord: Vec2, camera: Vec2) => Vec2 }>(
    wgslModule(REFLECTION_TEMPORAL_WGSL),
    ['temporalOwnMotion'],
    {
      REFLECTION_LAYER: layer,
      reflectionView: { jitter },
      temporalVectors: { load: () => [word, 0, 0, 0] },
      textureDimensions: () => SIZE,
      reflectionViewport: () => SIZE,
    },
  ).temporalOwnMotion
const near = (a: readonly number[], b: readonly number[], what: string) =>
  a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 2e-3, `${what}: ${a} against ${b}`))

const coord: Vec2 = [20, 10]
// The pixel's own device position, its texel's centre, and where the camera alone puts its point.
const here: Vec2 = [(20.5 / 64) * 2 - 1, 1 - (10.5 / 32) * 2]
const camera: Vec2 = [here[0] - 0.05, here[1] + 0.02]
const moving: Vec2 = [0.125, -0.0625]

test('a still pixel reads its history where the camera alone puts its point', () => {
  const vector: Vec2 = [here[0] - camera[0], here[1] - camera[1]]
  near(ownMotion(codec.encodeOwnVector(vector, false))(coord, camera), [0, 0], 'no own motion')
  const jittered = ownMotion(codec.encodeOwnVector(vector, false), 0, [0.01, -0.02, 0.03, 0.01])
  near(jittered(coord, camera), [0, 0], 'whatever the jitter')
})

test('a dynamic pixel reads its history where its vector says it stood: the camera position less its own motion', () => {
  const own = ownMotion(codec.encodeOwnVector(moving, true))(coord, camera)
  // Its own motion is the vector less the camera's motion at the pixel.
  near(own, [moving[0] - (here[0] - camera[0]), moving[1] - (here[1] - camera[1])], 'own motion')
  // The history's position, `clip(Q) − own`, is the pixel's less its vector.
  near(
    [camera[0] - own[0], camera[1] - own[1]],
    [here[0] - moving[0], here[1] - moving[1]],
    'stood',
  )
})

test('the jitter of either image never reads as a dynamic surface’s own motion', () => {
  // This image's jitter `c`, the last's `p`: the vectors are drawn without them; the jittered camera
  // position carries the last's.
  const [c, p]: Vec2[] = [
    [0.01, -0.02],
    [-0.03, 0.01],
  ]
  const own = ownMotion(codec.encodeOwnVector(moving, true), 0, [...c, ...p])
  const jittered: Vec2 = [camera[0] + p[0], camera[1] + p[1]]
  near(
    own(coord, jittered),
    ownMotion(codec.encodeOwnVector(moving, true))(coord, [camera[0] + c[0], camera[1] + c[1]]),
    'unjittered',
  )
})

test('a still view reads its history at the pixel’s centre whatever the jitter of either image', () => {
  const { temporalHistoryNdc } = shaderRun<{ temporalHistoryNdc: (clip: number[]) => Vec2 }>(
    wgslModule(REFLECTION_TEMPORAL_WGSL),
    ['temporalHistoryNdc'],
    { reflectionView: { jitter: [0.03, -0.02, -0.01, 0.04] } },
  )
  // The pixel's point lies at its centre `here` in this image less this image's jitter; the last image, the camera still, shows it there plus its own.
  const clip = [(here[0] - 0.03 + -0.01) * 2, (here[1] + 0.02 + 0.04) * 2, 0.5, 2]
  near(temporalHistoryNdc(clip), here, 'the pixel centre')
})

test('the transparents’ front surface has no vector: no own motion', () => {
  near(ownMotion(codec.encodeOwnVector(moving, true), 1)(coord, camera), [0, 0], 'front')
})

test('the vectors are read against the image just before alone, and the view tells both jitters', () => {
  assert.equal(vectorsReach(heldImage({ valid: true, image: 6 }), 7), true)
  assert.equal(vectorsReach(heldImage({ valid: true, image: 5 }), 7), false, 'an older image')
  assert.equal(vectorsReach(heldImage({ image: 6 }), 7), false, 'none held')
  const gpu = fakeDevice()
  const buffer = gpu.device.createBuffer({
    size: REFLECTION_VIEW_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { data } = buffer as unknown as FakeBuffer
  const words = new Float32Array(data.buffer, data.byteOffset, REFLECTION_VIEW_WORDS)
  const frame = {
    viewProjection: new Float64Array(16),
    eye: [0, 0, 0],
    size: SIZE,
    depthDrawn: true,
  }
  createReflectionViewWriter(gpu.device, buffer)(
    { ...frame, jitter: [0.25, -0.5] },
    heldImage({ jitter: [0.125, 0.75] }),
  )
  const at = REFLECTION_VIEW_AT.jitter
  assert.deepEqual([...words.slice(at, at + 4)], [0.25, -0.5, 0.125, 0.75])
})

test('a history is held within the neighbourhood alone: twice its extent for a reconstructed sample, never its own spread', () => {
  const text = wgslModule(REFLECTION_TEMPORAL_WGSL)
  assert.match(text, /let extent=window\.extent\*select\(1\.0,2\.0,reconstructed\);/)
  assert.doesNotMatch(text, /extent=max\(/)
})

test('the history of the hit is read where the reflection seems to lie: the pixel’s view ray, a hit’s distance deeper than the surface', () => {
  // A perspective looking down +z from the origin: a point's clip `w` is its depth.
  const viewProj = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0])
  const hitPoint = (slab: number[]) =>
    shaderRun<{ temporalHitPoint: (P: number[], V: number[], hit: number) => number[] }>(
      wgslModule(REFLECTION_TEMPORAL_WGSL),
      ['temporalHitPoint'],
      { reflectionView: { slab, viewProj }, view: { camera: [0, 0, 0, 1] } },
    ).temporalHitPoint
  const P = [3, 1, 10]
  const toEye = P.map((x) => -x / Math.hypot(...P))
  const seen = hitPoint([0, 0, 0, 1])(P, toEye, 5)
  near(
    seen.map((x, k) => x / P[k]),
    [1.5, 1.5, 1.5],
    'on the ray',
  )
  assert.ok(Math.abs(seen[2] - 15) < 2e-3, `the depth, 10 and the hit’s 5: ${seen[2]}`)
  // An orthographic projection: the hit's distance along the view direction.
  near(hitPoint([0, 0, 0, 0])(P, [0, 0, -1], 5), [3, 1, 15], 'orthographic')
})

test('a history holds what it read as its second moment and what it stores is finite and above zero', () => {
  const text = wgslModule(REFLECTION_TEMPORAL_WGSL)
  assert.match(text, /moment=mix\(heldMoment,moment,fresh\);/)
  assert.doesNotMatch(text, /variance/, 'the moment is not derived again from the spread')
  assert.match(
    text,
    /historyPack\(reflectionLinear\(max\(makeFinite3\(lighting\),vec3f\(0\.0\)\)\),surfaceLinearDepth\(P\),max\(makeFinite\(moment\),0\.0\),count\)/,
  )
})

test('the images a history holds are the setting’s, down to two for a mirror, over the mirror’s roughness', () => {
  const { reflectionMaxFrames } = shaderRun<{
    reflectionMaxFrames: (f: number, r: number) => number
  }>(wgslModule(REFLECTION_TEXEL_WGSL), ['reflectionMaxFrames'], {})
  assert.equal(reflectionMaxFrames(12, 0), 2)
  near([reflectionMaxFrames(12, 0.025)], [7], 'halfway')
  // The roughness at the mirror's bar, read as the shader reads it (both in f32): the whole history.
  assert.equal(reflectionMaxFrames(12, Math.fround(0.05)), 12)
  assert.equal(reflectionMaxFrames(12, 0.5), 12)
})

test('a dynamic pixel’s depth is carried by its own step: the step the velocity stage drew less the depth the camera alone takes off it', () => {
  const ownDepth = (word: number, flags: number, layer = 0) =>
    shaderRun<{ temporalOwnDepth: (coord: Vec2, nowZ: number, cameraZ: number) => number }>(
      wgslModule(REFLECTION_TEMPORAL_WGSL),
      ['temporalOwnDepth'],
      {
        REFLECTION_LAYER: layer,
        temporalVectors: { load: () => [word, flags, 0, 0] },
        textureDimensions: () => SIZE,
      },
    ).temporalOwnDepth(coord, 0.5, 0.375)
  const moving = codec.encodeOwnVector([0.125, -0.0625], true)
  const flags = codec.withDepthStep(0, 0.25)
  // The pixel's device depth 0.5 became 0.375 by the camera's motion alone: the step 0.25 less that 0.125.
  near([ownDepth(moving, flags)], [0.125], 'own step')
  // The camera's motion alone (a step of 0.125) moves the surface by none of its own.
  near([ownDepth(moving, codec.withDepthStep(0, 0.125))], [0], 'the camera’s step')
  near([ownDepth(codec.encodeOwnVector([0.125, -0.0625], false), flags)], [0], 'a still pixel')
  near([ownDepth(moving, flags, 1)], [0], 'the front surface has no vector')
})

test('every constant of the reference in pre-exposed radiance is divided by the image’s pre-exposure: the better history’s margin, the clamp’s floor, the denoiser’s tonemap', () => {
  const text = wgslModule(REFLECTION_TEMPORAL_WGSL)
  assert.match(
    text,
    /length\(window\.centre-surfaceY\)\+0\.01\/max\(view\.preExposure\.x,REFLECTION_EPSILON\)\)\{alpha=0\.8;\}/,
  )
  assert.match(text, /REFLECTION_CLAMP_FLOOR\/max\(view\.preExposure\.x,REFLECTION_EPSILON\)/)
  assert.match(
    wgslModule(REFLECTION_TEXEL_WGSL),
    /view\.preExposure\.x\/reflectionView\.denoise\.w/,
  )
  // No read of the CPU exposure is left: the view's structure still declares it.
  assert.doesNotMatch(`${text}${wgslModule(REFLECTION_TEXEL_WGSL)}`, /view\.lightParams/)
  // The tonemap's scale: a radiance of the range's luminance, once pre-exposed, weighs half.
  const { reflectionDenoised } = shaderRun<{ reflectionDenoised: (c: number[]) => number[] }>(
    wgslModule(REFLECTION_TEXEL_WGSL),
    ['reflectionDenoised'],
    { view: { preExposure: [0.5, 0, 0, 0] }, reflectionView: { denoise: [12, 1, 0.03, 10] } },
  )
  // Luminance 20 at a pre-exposure of 0.5 is 10 pre-exposed: weighed by 1 / (1 + 10 / 10) = ½.
  near(reflectionDenoised([20, 20, 20]), [10, 10, 10], 'half')
})

test('a fresh hit is held at the miss distance, 65504 cm, as far as a ray goes; a nearer one keeps its own', () => {
  const { freshHit, freshPack } = shaderRun<{
    freshPack: (r: number[], hit: number) => number[]
    freshHit: (t: number[]) => number
  }>(wgslModule(REFLECTION_TEXEL_WGSL), ['freshPack', 'freshHit'], {})
  const read = (hit: number) => freshHit(freshPack([1, 1, 1], hit).slice(0, 2))
  // The greatest half under 655.04 is 655: the store rounds the miss distance to its half, never past it.
  assert.equal(read(1000), 655)
  assert.equal(read(4e4), 655)
  assert.equal(read(12.5), 12.5)
})

test('a view cut, a lit image no cut has left alone and the temporal setting off each start the history again: the pixel keeps its fresh light and counts no image', () => {
  const written = (traced: number, accumulating: boolean) => {
    const { temporalPixel } = shaderRun<{
      temporalPixel: (coord: Vec2, local: Vec2, layer: number) => { light: number[]; count: number }
    }>(wgslModule(REFLECTION_TEMPORAL_WGSL), ['temporalPixel'], {
      reflectionView: { traced: [traced, 0, 0, 0] },
      reflectionDone: () => accumulating,
      temporalShare: () => [0.5, 0.25, 0.125, 1],
      fromYcocg: (c: number[]) => c,
      luminance: (c: number[]) => c[0],
      surfaceFlagsAt: () => 0,
      surfaceTopRawAt: () => [0, 0, 1, 0.5],
      surfacePointAt: () => [0, 0, 0],
      viewToEye: () => [0, 0, 1],
      surfaceLinearDepth: () => 1,
      reflectionLinear: (c: number[]) => c,
      makeFinite3: (c: number[]) => c,
      makeFinite: (x: number) => x,
      historyPack: (light: number[], _depth: number, _moment: number, count: number) => ({
        light,
        count,
      }),
    })
    return temporalPixel(coord, [0, 0], 0)
  }
  // The share the resolve wrote is the pixel's light as it is, no history mixed in, whichever way the history is refused.
  for (const [traced, accumulating, why] of [
    [0, true, 'the screen is not traced against the last image: a view cut'],
    [1, false, 'the temporal pass is off'],
  ] as const) {
    const fresh = written(traced, accumulating)
    near(fresh.light, [0.5, 0.25, 0.125], why)
    assert.equal(fresh.count, 0, why)
  }
})
