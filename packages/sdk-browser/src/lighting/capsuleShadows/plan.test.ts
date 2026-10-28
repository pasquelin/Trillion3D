// What a capsule shadow pass is given: the sizes of its textures and dispatch, the light's numbers, the words of its uniform.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPSULE_PARAM_FLOATS,
  CAPSULE_PARAMS,
  LIGHT_DIRECTION_PARAM_FLOATS,
  UPSAMPLE_PARAM_FLOATS,
  UPSAMPLE_PARAMS,
} from './layout.ts'
import {
  capsuleDepthTerms,
  capsuleDownsample,
  capsuleFactorsSize,
  capsuleGrid,
  createCapsuleParams,
  lightDirectionGroups,
  skyLightMode,
  writeCapsuleParams,
  writeUpsampleParams,
  writeLightDirectionParams,
  type CapsulePass,
} from './plan.ts'

test('the factors are computed at half the image each way unless the full resolution is asked', () => {
  assert.equal(capsuleDownsample(false), 2)
  assert.equal(capsuleDownsample(true), 1)
  // An odd image keeps its last row and column (the reference rounds down and loses them).
  assert.deepEqual(capsuleFactorsSize([1921, 1081], 2), [961, 541])
  assert.deepEqual(capsuleFactorsSize([1921, 1081], 1), [1921, 1081])
})

test('the tiles cover the downsampled rectangle; a light always has one', () => {
  assert.deepEqual(capsuleGrid([1000, 600], 2, true), {
    width: 500,
    height: 300,
    tilesAcross: 63,
    tilesDown: 38,
  })
  const empty = capsuleGrid([0, 0], 2, true)
  assert.deepEqual([empty.tilesAcross, empty.tilesDown], [1, 1])
  const none = capsuleGrid([0, 0], 2, false)
  assert.deepEqual([none.tilesAcross, none.tilesDown], [0, 0])
  assert.equal(lightDirectionGroups(0), 0)
  assert.equal(lightDirectionGroups(65), 2)
})

/** The uniform of a pass lit by `light`, read where the layout puts the light's source radius, its cone angle and the fade's terms. */
const uniformOf = (patch: Partial<CapsulePass> = {}) =>
  writeCapsuleParams(createCapsuleParams(), pass(patch))
const light = (
  sourceRadius: number,
  invRadius: number,
  sourceAngle = 0,
): NonNullable<CapsulePass['light']> => ({
  directional: false,
  position: [0, 0, 0],
  direction: [0, 0, 1],
  invRadius,
  sourceRadius,
  sourceAngle,
})
const radiusOf = (sourceRadius: number, invRadius: number) =>
  uniformOf({ light: light(sourceRadius, invRadius) })[CAPSULE_PARAMS.shape]

test('the source radius: 20 centimetres for none, else between a hundredth of a millimetre and a quarter of the light radius', () => {
  assert.equal(radiusOf(0, 0.1), Math.fround(0.2))
  assert.equal(radiusOf(0.5, 0.1), 0.5)
  assert.equal(radiusOf(0.000001, 0.1), Math.fround(1e-5))
  assert.equal(radiusOf(9, 0.1), 2.5)
  assert.equal(radiusOf(9, 0), 9, 'a light with no radius has no upper bound')
})

test('a directional light’s cone is five times its source angle, held between 1 and 30 degrees', () => {
  const angleOf = (degrees: number) =>
    uniformOf({ light: light(0, 0.1, degrees) })[CAPSULE_PARAMS.lightAim + 3]
  assert.equal(angleOf(0), Math.fround(Math.PI / 180))
  assert.equal(angleOf(2), Math.fround((10 * Math.PI) / 180))
  assert.equal(angleOf(40), Math.fround((30 * Math.PI) / 180))
})

test('the fade ramp starts at the cosine of the angle and is never infinite', () => {
  const ramp = uniformOf({ fadeAngle: Math.PI / 3 })
  assert.ok(
    Math.abs(ramp[CAPSULE_PARAMS.fade] - 0.5) < 1e-6 &&
      Math.abs(ramp[CAPSULE_PARAMS.fade + 1] - 2) < 1e-6,
  )
  assert.ok(Number.isFinite(uniformOf({ fadeAngle: 0 })[CAPSULE_PARAMS.fade + 1]))
})

const pass = (patch: Partial<CapsulePass> = {}): CapsulePass => ({
  clipToView: Array.from({ length: 16 }, (_, i) => i),
  viewToWorld: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
  preViewTranslation: [1, 2, 3],
  perspective: true,
  viewport: [0, 0, 1920, 1080],
  scissor: [0, 0, 1920, 1080],
  downsample: 2,
  maxOcclusionDistance: 4,
  shapeCount: 12,
  tilesAcross: 120,
  tilesDown: 68,
  fadeAngle: Math.PI / 3,
  casterCount: 3,
  depth: [0.1, 0, 1],
  selfShadowIntensity: 0.5,
  ...patch,
})

test('the uniform holds the matrices, the translated light, the sizes and the fade, each where the layout says', () => {
  const out = writeCapsuleParams(
    createCapsuleParams(),
    pass({
      light: {
        directional: false,
        position: [10, 0, 0],
        direction: [0, 0, 1],
        invRadius: 0.1,
        sourceRadius: 0,
        sourceAngle: 0,
      },
    }),
  )
  assert.equal(out.length, CAPSULE_PARAM_FLOATS)
  assert.deepEqual(
    [...out.slice(CAPSULE_PARAMS.clipToView, CAPSULE_PARAMS.clipToView + 4)],
    [0, 1, 2, 3],
  )
  // The view's matrix carries the translation on its last column.
  const world = CAPSULE_PARAMS.viewToTranslatedWorld
  assert.deepEqual(
    [out[world + 12], out[world + 13], out[world + 14], out[world + 15]],
    [1, 2, 3, 1],
  )
  assert.deepEqual(
    [...out.slice(CAPSULE_PARAMS.lightPosition, CAPSULE_PARAMS.lightPosition + 4)].map((v) =>
      Math.fround(v),
    ),
    [11, 2, 3, Math.fround(0.1)],
  )
  assert.deepEqual(
    [...out.slice(CAPSULE_PARAMS.shape, CAPSULE_PARAMS.shape + 4)].map((v) => Math.fround(v)),
    [Math.fround(0.2), 4, 2, 12],
  )
  assert.deepEqual(
    [...out.slice(CAPSULE_PARAMS.extra, CAPSULE_PARAMS.extra + 4)],
    [120, 68, 0.5, 1],
  )
  assert.ok(Math.abs(out[CAPSULE_PARAMS.fade] - 0.5) < 1e-6)
  assert.equal(out[CAPSULE_PARAMS.fade + 2], 3)
  assert.deepEqual(
    [...out.slice(CAPSULE_PARAMS.translation, CAPSULE_PARAMS.translation + 4)],
    [1, 2, 3, 0],
  )
  assert.deepEqual(
    [...out.slice(CAPSULE_PARAMS.depth, CAPSULE_PARAMS.depth + 4)].map((v) => Math.fround(v)),
    [Math.fround(0.1), 0, 1, 0],
  )
})

test('an indirect pass writes no light, and an orthographic view says so', () => {
  const out = writeCapsuleParams(createCapsuleParams().fill(7), pass({ perspective: false }))
  assert.deepEqual(
    [...out.slice(CAPSULE_PARAMS.lightPosition, CAPSULE_PARAMS.lightPosition + 8)],
    new Array(8).fill(0),
  )
  assert.equal(out[CAPSULE_PARAMS.shape], 0)
  assert.equal(out[CAPSULE_PARAMS.extra + 3], 0)
})

test('the light direction pass is told its records, the sky light’s mode and the settings', () => {
  assert.equal(skyLightMode(undefined), 0)
  assert.equal(skyLightMode({ wantsStaticShadowing: false, realTimeCapture: false }), 0)
  assert.equal(skyLightMode({ wantsStaticShadowing: true, realTimeCapture: false }), 1)
  assert.equal(skyLightMode({ wantsStaticShadowing: true, realTimeCapture: true }), 2)
  const out = new Float32Array(LIGHT_DIRECTION_PARAM_FLOATS)
  writeLightDirectionParams(out, 5, 2, {
    capsuleIndirectConeAngle: 0.5,
    capsuleSkyAngleScale: 0.6,
    capsuleMinSkyAngle: 15,
  })
  const words = new Uint32Array(out.buffer)
  assert.deepEqual([words[0], words[1]], [5, 2])
  assert.deepEqual([...out.slice(4, 7)], [0.5, Math.fround(0.6), 15])
})

test('a device depth is a distance by the near plane over it for a perspective view, linearly for an orthographic one', () => {
  assert.deepEqual(capsuleDepthTerms({ perspective: true, near: 0.1, far: 1000 }), [0.1, 0, 1])
  assert.deepEqual(capsuleDepthTerms({ perspective: false, near: 1, far: 11 }), [10, 1, 0])
})

test('the upsample uniform: the image and the factors’ sizes, the tiles, the attenuation switch and the depth terms', () => {
  const out = writeUpsampleParams(new Float32Array(UPSAMPLE_PARAM_FLOATS), {
    scissor: [0, 0, 1920, 1080],
    viewport: [0, 0, 1920, 1080],
    extent: [1921, 1081],
    downsample: 2,
    grid: { width: 960, height: 540, tilesAcross: 120, tilesDown: 68 },
    attenuation: true,
    selfShadowIntensity: 0.8,
    depth: [0.1, 0, 1],
  })
  // The factors of an image of odd size are rounded up (`ceilDiv`): the reference rounds down (`CapsuleShadowRendering.cpp:159,545`) and loses the last row and column, a bug of its that is corrected here.
  assert.deepEqual(
    [...out.slice(UPSAMPLE_PARAMS.low, UPSAMPLE_PARAMS.low + 4)],
    [961, 541, 960, 540],
  )
  assert.deepEqual([...out.slice(UPSAMPLE_PARAMS.tile, UPSAMPLE_PARAMS.tile + 4)], [120, 68, 16, 1])
  assert.equal(out[UPSAMPLE_PARAMS.shading + 1], 2)
  assert.equal(out[UPSAMPLE_PARAMS.buffer], 1921)
})
