import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { LIGHTING_PARAMS, SELF_INTERSECTION } from './layout.ts'
import { shapeOf, writeLightingParams } from './params.ts'
import { lightingImage, lightingSettings as settings, near } from './params.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'

test('the radiosity’s traced rays carry the reference’s biases and distances, in centimetres, and the avoidance setting as it is', () => {
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  const floats = new Float32Array(words.buffer)
  const shape = shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT)
  const at = LIGHTING_PARAMS.at
  writeLightingParams(words, shape, settings, lightingImage())
  near(floats[at.radiosityRayBias], 0.1)
  near(floats[at.radiosityNormalBias], 0.1)
  near(floats[at.cardDepthBias], 10)
  near(floats[at.cardMinDistance], 10)
  assert.equal(
    words[at.selfIntersections],
    SURFACE_CACHE_RULES.surfaceCacheHardwareRayTracingAvoidSelfIntersections.default,
  )
  // What a host names reaches the words.
  writeLightingParams(
    words,
    shape,
    {
      ...settings,
      surfaceCacheRadiosityHardwareRayTracingBias: 0.5,
      surfaceCacheRadiosityHardwareRayTracingNormalBias: 0.25,
      surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias: 20,
      surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache: 4,
      surfaceCacheHardwareRayTracingAvoidSelfIntersections: 1,
    },
    lightingImage(),
  )
  near(floats[at.radiosityRayBias], 0.5)
  near(floats[at.radiosityNormalBias], 0.25)
  near(floats[at.cardDepthBias], 20)
  near(floats[at.cardMinDistance], 4)
  assert.equal(words[at.selfIntersections], SELF_INTERSECTION.retrace)
})
