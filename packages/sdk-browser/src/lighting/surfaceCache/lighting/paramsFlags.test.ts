// The lighting's image parameters (`params.ts`): the frustum, the flags the settings carry, and the cull to the depth range of a tile.

import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHTING_FLAG, LIGHTING_PARAMS } from './layout.ts'
import { shapeOf, writeLightingParams } from './params.ts'
import {
  lightingImage,
  lightingSettings as settings,
  near,
  outside,
  planesOf,
  viewProjection,
} from './params.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'

/** An image from the origin, its view the one of a camera there. */
const atOrigin = (image: Parameters<typeof lightingImage>[0] = {}) =>
  lightingImage({ viewProjection: viewProjection([0, 0, 0]), ...image })

test('the frustum planes are outward, in centimetres from the eye, whatever the eye', () => {
  for (const eye of [
    [0, 0, 0],
    [30, -4, 12.5],
  ]) {
    const planes = planesOf(eye)
    // A point ahead is inside every plane (left, right, bottom, top, near).
    const ahead = [0, 0, -1000]
    for (let k = 0; k < 5; k++) assert.ok(outside(planes, k, ahead) < 0, `ahead, plane ${k}`)
    // Past each side it is outside that plane alone, by its distance to it.
    near(outside(planes, 0, [-1000, 0, -500]), 500 / Math.SQRT2, 1e-2)
    near(outside(planes, 1, [1000, 0, -500]), 500 / Math.SQRT2, 1e-2)
    near(outside(planes, 2, [0, -1000, -500]), 500 / Math.SQRT2, 1e-2)
    near(outside(planes, 3, [0, 1000, -500]), 500 / Math.SQRT2, 1e-2)
    // Behind the eye is outside the near plane, 10 cm in front of it is the plane.
    assert.ok(outside(planes, 4, [0, 0, 500]) > 0)
    near(outside(planes, 4, [0, 0, -10]), 0, 1e-2)
  }
})

test("an image's parameters carry the settings: the flags, the pre-exposed ray limit, the view's ray reach in centimetres, the eye in both units", () => {
  const shape = shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT)
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  writeLightingParams(words, shape, settings, {
    frame: 9,
    noiseFrame: 0,
    pages: 12,
    eye: [1, 2, 3],
    viewProjection: viewProjection([1, 2, 3]),
    preExposure: 0.5,
    viewPreExposure: 0.25,
    firstClipmapExtent: 2500,
    maxTraceDistance: 50,
    historyLost: false,
    feedback: true,
    tracedRadiosity: false,
    scratchAt: 4096,
    exposure: 0.75,
  })
  const floats = new Float32Array(words.buffer)
  const at = LIGHTING_PARAMS.at
  assert.equal(words[at.frame], 9)
  assert.equal(words[at.scratchAt], 4096)
  assert.equal(floats[at.exposure], 0.75)
  assert.equal(words[at.pages], 12)
  assert.equal(words[at.spacingShift], 2)
  assert.equal(words[at.maxFrames], 4)
  assert.equal(new Int32Array(words.buffer)[at.fixedJitter], -1)
  near(floats[at.firstClipmapRcp], 1 / 2500)
  near(floats[at.maxRayIntensity], 160)
  near(floats[at.camera + 2], 300)
  near(floats[at.eye + 2], 3)
  near(floats[at.maxTrace], 5000)
  const all =
    LIGHTING_FLAG.direct |
    LIGHTING_FLAG.radiosity |
    LIGHTING_FLAG.prioritizeFrustum |
    LIGHTING_FLAG.filter |
    LIGHTING_FLAG.temporal |
    LIGHTING_FLAG.planeWeighting |
    LIGHTING_FLAG.historyValid |
    LIGHTING_FLAG.adaptiveShadowTracing |
    LIGHTING_FLAG.feedback |
    LIGHTING_FLAG.cullToTileDepthRange |
    LIGHTING_FLAG.lightTilesPerType
  assert.equal(words[at.flags], all)
  // The traced shadow's biases, in centimetres: the reference's defaults.
  near(floats[at.traceRayBias], 1)
  near(floats[at.traceEndBias], 1)
  // A lost history clears its flag; no prioritising near the frustum is the setting -1.
  writeLightingParams(
    words,
    shape,
    { ...settings, surfaceCacheLightingMaxDistanceFromFrustumToPrioritize: -1 },
    atOrigin({ historyLost: true, feedback: true }),
  )
  assert.equal(
    words[at.flags],
    all & ~LIGHTING_FLAG.historyValid & ~LIGHTING_FLAG.prioritizeFrustum,
  )
})

test('the frozen update frame and the two-sided shadow rays are flags of the settings, the adaptive tracing one off', () => {
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  writeLightingParams(
    words,
    shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT),
    {
      ...settings,
      surfaceCacheFreezeUpdateFrame: 1,
      surfaceCacheDirectLightingHardwareRayTracingForceTwoSided: true,
      surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing: false,
    },
    atOrigin(),
  )
  const flags = words[LIGHTING_PARAMS.at.flags]
  assert.ok(flags & LIGHTING_FLAG.freezeUpdateFrame)
  assert.ok(flags & LIGHTING_FLAG.forceTwoSided)
  assert.equal(flags & LIGHTING_FLAG.adaptiveShadowTracing, 0)
})

test('the lights are culled to the depth range of the tile unless the setting is off', () => {
  const flagOf = (cull: boolean) => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    writeLightingParams(
      words,
      shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT),
      { ...settings, surfaceCacheDirectLightingCullToTileDepthRange: cull },
      atOrigin(),
    )
    return words[LIGHTING_PARAMS.at.flags] & LIGHTING_FLAG.cullToTileDepthRange
  }
  assert.equal(settings.surfaceCacheDirectLightingCullToTileDepthRange, true)
  assert.equal(flagOf(true), LIGHTING_FLAG.cullToTileDepthRange)
  assert.equal(flagOf(false), 0)
})

test('the light tiles of the point lights, the spots and the rectangles are gathered by their type at the reference default of the batching, 2, and each light by itself at 0 and 1', () => {
  const flagOf = (batch: number) => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    writeLightingParams(
      words,
      shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT),
      { ...settings, surfaceCacheDirectLightingBatchShadows: batch },
      atOrigin(),
    )
    return words[LIGHTING_PARAMS.at.flags] & LIGHTING_FLAG.lightTilesPerType
  }
  assert.equal(settings.surfaceCacheDirectLightingBatchShadows, 2)
  assert.equal(flagOf(2), LIGHTING_FLAG.lightTilesPerType)
  assert.equal(flagOf(1), 0)
  assert.equal(flagOf(0), 0)
})

test('a frozen cache lights no tile and holds the update frame, its lists keeping their size', () => {
  const written = (changes: Partial<typeof settings>) => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    const shape = shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT)
    writeLightingParams(words, shape, { ...settings, ...changes }, lightingImage())
    return { words, shape }
  }
  const at = LIGHTING_PARAMS.at
  const lit = written({})
  assert.equal(lit.words[at.directTiles], lit.shape.directTiles)
  assert.equal(lit.words[at.indirectTiles], lit.shape.indirectTiles)
  assert.equal(lit.words[at.flags] & LIGHTING_FLAG.freezeUpdateFrame, 0)
  const frozen = written({ surfaceCacheFreeze: true })
  assert.equal(frozen.words[at.directTiles], 0)
  assert.equal(frozen.words[at.indirectTiles], 0)
  assert.ok(frozen.words[at.flags] & LIGHTING_FLAG.freezeUpdateFrame)
  // The lists the shape makes are those of the unfrozen cache.
  assert.deepEqual(
    shapeOf({ ...settings, surfaceCacheFreeze: true }, 1024, false, WORD_LIGHT_FORMAT),
    lit.shape,
  )
  // A frozen update frame alone still lights its tiles.
  assert.equal(
    written({ surfaceCacheFreezeUpdateFrame: 1 }).words[at.directTiles],
    lit.shape.directTiles,
  )
})

test('a second view the cache keeps cards for is written beside the main one: its eye in centimetres, flagged, and its own frustum', () => {
  const shape = shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT)
  const write = (image: Parameters<typeof lightingImage>[0]) => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    writeLightingParams(words, shape, settings, atOrigin(image))
    return new Float32Array(words.buffer)
  }
  const none = write({})
  assert.equal(none[LIGHTING_PARAMS.at.otherEye + 3], 0, 'no second view: none flagged')
  const eye = [30, -4, 12.5]
  const floats = write({ other: { eye, viewProjection: viewProjection(eye) } })
  assert.deepEqual(
    [...floats.subarray(LIGHTING_PARAMS.at.otherEye, LIGHTING_PARAMS.at.otherEye + 4)],
    [3000, -400, 1250, 1],
  )
  const planes = floats.subarray(
    LIGHTING_PARAMS.at.otherFrustum,
    LIGHTING_PARAMS.at.otherFrustum + 20,
  )
  assert.deepEqual(
    [...planes],
    [...planesOf(eye)],
    "the frustum is the second view's own, from its own eye",
  )
})
