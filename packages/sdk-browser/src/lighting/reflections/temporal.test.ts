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
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { heldImage } from './heldImage.fixture.ts'
import { vectorsReach } from './litImage.ts'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { createReflectionViewWriter } from './viewWrite.ts'

type Vec2 = [number, number]

const SIZE: Vec2 = [64, 32]
const codec = shaderRun<{ encodeOwnVector: (v: Vec2, own: boolean) => number }>(
  VECTOR_CODEC_WGSL,
  ['encodeOwnVector'],
  {},
)
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
