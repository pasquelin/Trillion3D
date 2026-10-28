// The irradiance field's cache: the levels and pool its settings name, the settings its cache follows, and the extents of its irradiance and occlusion maps.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { probePoolOf, probeRowOf } from '../../../../../sdk-core/src/bounce/contracts.ts'
import {
  irradianceFieldAtlases,
  irradianceFieldCacheSettings,
  irradianceFieldShape,
} from './shape.ts'

test('the field’s cache is shaped by the field’s settings: its levels, the cells and growth of them, and the pool of its atlas', () => {
  const field = screenProbeSettings({
    irradianceFieldNumClipmaps: 3,
    irradianceFieldGridResolution: 32,
  }).irradianceField
  assert.deepEqual(irradianceFieldShape(field), {
    cascadeLevels: 3,
    cascadeSize: 32,
    cascadeHalfExtentMetres: 50,
    cascadeBase: 2,
    probePool: probePoolOf(128),
  })
})

test('the field’s cache follows the screen probes’ settings but for the maps’ side, their levels of detail, the probes traced an image and the marks’ reduction', () => {
  const screen = screenProbeSettings({
    irradianceFieldProbeResolution: 24,
    irradianceFieldNumMipmaps: 2,
    irradianceFieldNumProbesToTraceBudget: 40,
  })
  const settings = irradianceFieldCacheSettings(screen)
  assert.deepEqual(
    [
      settings.cache.resolution,
      settings.cache.mipmaps,
      settings.cache.budget,
      settings.cache.markDownsample,
    ],
    [24, 2, 40, 4],
    'a mark reduction of 2 on top of the interpolation’s 2',
  )
  assert.equal(
    settings.cache.filter,
    screen.cache.filter,
    'the filter is the one every cache shares',
  )
  assert.equal(settings.cache.skyVisibility, false)
})

test('the irradiance and occlusion maps of the probes are squares with a border of one, in the rows of the pool', () => {
  const field = screenProbeSettings({}).irradianceField
  const pool = probePoolOf(field.atlasProbes)
  const row = probeRowOf(pool)
  const { irradiance, occlusion } = irradianceFieldAtlases(field, row, pool)
  assert.deepEqual(irradiance, [row * 8, (pool / row) * 8])
  assert.deepEqual(occlusion, [row * 18, (pool / row) * 18])
})
