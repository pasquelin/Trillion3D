// The radiosity's probe occlusion: off by default, asked for by the shape only for the rays through the scene's triangles, and
// on in an image only where those rays were cast.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHTING_FLAG, LIGHTING_PARAMS } from './layout.ts'
import { shapeOf, sizesOf, writeLightingParams } from './params.ts'
import { lightingImage, lightingSettings as settings } from './params.fixture.ts'

const on = { ...settings, surfaceCacheRadiosityProbeOcclusion: true }

test('the probe occlusion is off by default at a strength of 0.5, and kept as a hit-distance atlas of 1 × 1 while off', () => {
  assert.equal(settings.surfaceCacheRadiosityProbeOcclusion, false)
  assert.equal(settings.surfaceCacheRadiosityProbeOcclusionStrength, 0.5)
  const off = shapeOf(settings, 1024, false)
  assert.equal(off.probeOcclusion, false)
  assert.equal(sizesOf(off).hitAtlas, 1)
})

test('the shape asks for the hit distances only with the occlusion on, a strength over 0, the radiosity and its rays through the triangles', () => {
  const shapeWith = (changes: object) => shapeOf({ ...on, ...changes }, 1024, false)
  const wanted = shapeWith({})
  assert.equal(wanted.probeOcclusion, true)
  assert.equal(sizesOf(wanted).hitAtlas, sizesOf(wanted).traceAtlas)
  assert.equal(shapeWith({ surfaceCacheRadiosityProbeOcclusionStrength: 0 }).probeOcclusion, false)
  assert.equal(shapeWith({ surfaceCacheRadiosityProbeOcclusionStrength: -1 }).probeOcclusion, false)
  assert.equal(shapeWith({ surfaceCacheRadiosityHardwareRayTracing: false }).probeOcclusion, false)
  assert.equal(shapeWith({ surfaceCacheRadiosity: false }).probeOcclusion, false)
})

test('the image’s flag is on only where the shape asks for the occlusion and the radiosity’s rays went through the triangles; the strength is held from 0 to 1', () => {
  const written = (
    values: typeof settings,
    tracedRadiosity: boolean,
  ): { flag: number; strength: number } => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    writeLightingParams(
      words,
      shapeOf(values, 1024, false),
      values,
      lightingImage({ tracedRadiosity }),
    )
    return {
      flag: words[LIGHTING_PARAMS.at.flags] & LIGHTING_FLAG.probeOcclusion,
      strength: new Float32Array(words.buffer)[LIGHTING_PARAMS.at.probeOcclusionStrength],
    }
  }
  assert.equal(written(on, true).flag, LIGHTING_FLAG.probeOcclusion)
  assert.equal(written(on, false).flag, 0)
  assert.equal(written(settings, true).flag, 0)
  assert.equal(written(on, true).strength, 0.5)
  assert.equal(written({ ...on, surfaceCacheRadiosityProbeOcclusionStrength: 3 }, true).strength, 1)
  assert.equal(
    written({ ...on, surfaceCacheRadiosityProbeOcclusionStrength: -3 }, true).strength,
    0,
  )
})
