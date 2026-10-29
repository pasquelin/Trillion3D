import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { SAMPLED_LIGHTS_RULES } from '../../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import {
  COMPLEXITY,
  VISUALIZE,
  complexityDrawn,
  complexityTargetOf,
  isOverview,
  overviewLayout,
  tileRect,
  visualizeLabel,
  visualizeViewOf,
} from './modes.ts'

const on = (extra: Record<string, number | boolean> = {}) =>
  resolveSettings(SAMPLED_LIGHTS_RULES, { sampledLights: true, ...extra })

test('a view is the setting’s number when it names one, else the diagnostic mode’s, none while the lighting is off', () => {
  assert.equal(visualizeViewOf(on(), 'beauty'), 0)
  assert.equal(visualizeViewOf(on(), 'sampled-lights-shadow-casters'), VISUALIZE.shadowCasters)
  assert.equal(visualizeViewOf(on(), 'sampled-lights-overview'), VISUALIZE.overview)
  assert.equal(
    visualizeViewOf(on({ sampledLightsVisualize: 7 }), 'sampled-lights-overview'),
    VISUALIZE.framesAccumulated,
  )
  assert.equal(
    visualizeViewOf(resolveSettings(SAMPLED_LIGHTS_RULES, { sampledLightsVisualize: 7 }), 'beauty'),
    0,
  )
})

test('the overviews lay their tiles out as the reference does', () => {
  assert.deepEqual(overviewLayout(VISUALIZE.overview), {
    tiles: [VISUALIZE.shadowCasters, VISUALIZE.shadowCasterQuality],
    perRow: 3,
  })
  const denoiser = overviewLayout(VISUALIZE.denoiserOverview)
  assert.equal(denoiser.perRow, 4)
  assert.equal(denoiser.tiles.length, 16)
  assert.equal(denoiser.tiles[1], VISUALIZE.diffuseDemodulate)
  assert.equal(
    overviewLayout(VISUALIZE.denoiserOverview2).tiles[1],
    VISUALIZE.diffuseHistorySpatialStdDev,
  )
  assert.equal(
    overviewLayout(VISUALIZE.denoiserOverview2).tiles[2],
    VISUALIZE.specularHistorySpatialStdDev,
  )
  assert.deepEqual(overviewLayout(VISUALIZE.shadingConfidence), { tiles: [6], perRow: 1 })
  assert.ok(isOverview(4) && isOverview(5) && isOverview(1) && !isOverview(6))
})

test('a tile of an overview is the share of the image after the margins, a lone view the whole image', () => {
  assert.deepEqual(tileRect([1920, 1080], 0, 1, true), [0, 0, 1920, 1080])
  // (1920 - 4 * 5) / 4 = 475 across, (1080 - 20) / 4 = 265 down.
  assert.deepEqual(tileRect([1920, 1080], 5, 4, false), [483, 273, 475, 265])
})

test('each view but the plain surface carries the words the reference writes', () => {
  assert.match(visualizeLabel(VISUALIZE.shadowCasters), /^Shadow Casters, Materials:0/)
  assert.match(
    visualizeLabel(VISUALIZE.framesAccumulated),
    /Red - invalid history, Yellow - first frame/,
  )
  assert.equal(visualizeLabel(VISUALIZE.overview), '')
  for (let view = 2; view <= 16; view++)
    if (!isOverview(view)) assert.notEqual(visualizeLabel(view), '', String(view))
})

test('the light complexity view is the mode’s input, else the setting’s, none while the lighting is off', () => {
  const modes = [
    ['sampled-lights-complexity-opaque', COMPLEXITY.opaque],
    ['sampled-lights-complexity-hair-strands', COMPLEXITY.hairStrands],
    ['sampled-lights-complexity-front-layer', COMPLEXITY.frontLayer],
    ['sampled-lights-complexity-volume', COMPLEXITY.volume],
    ['sampled-lights-complexity-translucency-volume', COMPLEXITY.translucencyVolume],
  ] as const
  for (const [mode, target] of modes) assert.equal(complexityTargetOf(on(), mode), target, mode)
  assert.equal(complexityTargetOf(on(), 'beauty'), 0)
  assert.equal(complexityTargetOf(on({ sampledLightsVisualizeLightComplexity: 4 }), 'beauty'), 4)
  // A mode wins over the setting, as the reference’s visualization mode wins over its variable.
  assert.equal(
    complexityTargetOf(on({ sampledLightsVisualizeLightComplexity: 4 }), modes[0][0]),
    COMPLEXITY.opaque,
  )
  assert.equal(
    complexityTargetOf(
      resolveSettings(SAMPLED_LIGHTS_RULES, { sampledLightsVisualizeLightComplexity: 1 }),
      'sampled-lights-complexity-volume',
    ),
    0,
  )
})

test('the light complexity view draws the surfaces and the nearest translucent layer, the other inputs not yet', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((target) => complexityDrawn(target)),
    [false, true, false, true, false, false],
  )
})
