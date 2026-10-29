// The irradiance field's short-range occlusion: the pass the screen probes run, over the tile the field's radius names and alone.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import {
  fieldOcclusionSettings,
  fieldSearchesOcclusion,
  reservoirOcclusionSettings,
  reservoirSearchesOcclusion,
} from './occlusionOnly.ts'

test('the field searches the occlusion over a tile of its radius in pixels, held to 4 and 64, with the amount alone', () => {
  const field = (radius: number, extra: object = {}) =>
    fieldOcclusionSettings(
      screenProbeSettings({ irradianceFieldShortRangeAORadius: radius, ...extra }),
    )
  assert.equal(
    field(32).downsampleFactor,
    32,
    'the reference’s default radius of 32 pixels: a reach of 64',
  )
  assert.equal(field(1).downsampleFactor, 4)
  assert.equal(field(500).downsampleFactor, 64)
  assert.equal(field(32).shortRangeGi, false)
  const ultra = screenProbeSettings({ screenProbes: 'ultra' })
  assert.equal(
    fieldOcclusionSettings(ultra).bentNormal,
    ultra.bentNormal,
    'the bent normal follows the view’s',
  )
  const settings = screenProbeSettings()
  assert.equal(
    fieldOcclusionSettings(settings),
    fieldOcclusionSettings(settings),
    'made once for a settings object',
  )
})

test('the field searches no occlusion where the switch is off, the intensity zero or the radius under a pixel', () => {
  assert.equal(fieldSearchesOcclusion(screenProbeSettings()), true)
  assert.equal(
    fieldSearchesOcclusion(screenProbeSettings({ screenProbeShortRangeOcclusion: false })),
    false,
  )
  assert.equal(
    fieldSearchesOcclusion(screenProbeSettings({ screenProbeOcclusionIntensity: 0 })),
    false,
  )
  assert.equal(
    fieldSearchesOcclusion(screenProbeSettings({ irradianceFieldShortRangeAORadius: 0 })),
    false,
  )
})

test('the reservoir gather searches the occlusion over a tile of half its reach in pixels, held to 4 and 64, once for a settings object and a tile', () => {
  const settings = (extra: object = {}) => screenProbeSettings(extra)
  assert.equal(reservoirOcclusionSettings(settings(), 1920).downsampleFactor, 19)
  assert.equal(
    reservoirOcclusionSettings(
      settings({ reservoirGatherShortRangeAOMaxScreenTraceFraction: 0.5 }),
      1920,
    ).downsampleFactor,
    64,
  )
  assert.equal(reservoirOcclusionSettings(settings(), 100).downsampleFactor, 4)
  assert.equal(reservoirOcclusionSettings(settings(), 100).shortRangeGi, false)
  const base = settings()
  assert.equal(reservoirOcclusionSettings(base, 1920), reservoirOcclusionSettings(base, 1920))
  assert.notEqual(reservoirOcclusionSettings(base, 1920), reservoirOcclusionSettings(base, 1280))
})

test('the reservoir gather searches no occlusion where its switch or the probes’ is off, the strength is zero or the reach under a pixel', () => {
  assert.equal(reservoirSearchesOcclusion(screenProbeSettings(), 1920), true)
  for (const off of [
    { reservoirGatherShortRangeAO: false },
    { screenProbeShortRangeOcclusion: false },
    { screenProbeOcclusionIntensity: 0 },
    { reservoirGatherShortRangeAOMaxScreenTraceFraction: 0 },
  ])
    assert.equal(
      reservoirSearchesOcclusion(screenProbeSettings(off), 1920),
      false,
      String(Object.keys(off)),
    )
})
