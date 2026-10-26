// The depth of field's settings: what the image effects' levels write of it, how it is drawn, and
// the plan of one image's draw.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  DEPTH_OF_FIELD_PRESET_LEVELS,
  DEPTH_OF_FIELD_RULES,
} from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { QUALITY_LEVELS } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import { resolveDepthOfField } from '../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import { circleRatio, planDepthOfField, tilesOf } from '../../post/effects/depthOfField/dofPlan.ts'
import { cocRadiusAt } from '../../post/effects/depthOfField/cocModel.ts'
import type { MeasuredWorld } from '../explorer.ts'
import { sessionOptions } from './options.ts'
import { worldSwitches } from './switches.ts'

test('the image effects’ levels write the depth of field’s gather and its accumulation, the top level none', () => {
  const fields = [
    'depthOfFieldQuality',
    'depthOfFieldAccumulator',
    'depthOfFieldRingCount',
    'depthOfFieldForegroundScatter',
    'depthOfFieldBackgroundScatter',
    'depthOfFieldRecombine',
    'depthOfFieldMaxForegroundRadius',
    'depthOfFieldTemporalQuality',
  ] as const
  // The reference's rows: off at the lowest, then fewer rings, less scatter, a smaller circle, the faster accumulation.
  const none = undefined // not written
  const rows = {
    smooth: ['off', none, none, none, none, none, none, none],
    balanced: [none, 'low', 3, 'off', 'off', 'off', 0.006, 'low'],
    fine: [none, 'low', 4, 'additive', 'additive', 'off', 0.012, 'low'],
    max: Array(8).fill(none),
  }
  for (const [level, expected] of Object.entries(rows)) {
    const written: Record<string, unknown> = QUALITY_LEVELS.imageEffects[level as keyof typeof rows]
    const got = fields.map((name) => written[name])
    assert.deepEqual(got, expected, level)
  }
})

test('the depth of field is drawn at the reference’s third level by default, the levels naming its settings only', () => {
  const d = resolveSettings(DEPTH_OF_FIELD_RULES, {})
  assert.deepEqual(
    [d.depthOfFieldQuality, d.depthOfFieldGatherDivisor, d.depthOfFieldAccumulator],
    ['on', 2, 'high'],
  )
  assert.deepEqual(
    [d.depthOfFieldPostfilter, d.depthOfFieldRingCount, d.depthOfFieldRecombine],
    ['median', 4, 'low'],
  )
  assert.deepEqual(
    [d.depthOfFieldForegroundScatter, d.depthOfFieldBackgroundScatter, d.depthOfFieldScatterBokeh],
    ['additive', 'occlusion', true],
  )
  assert.deepEqual([d.depthOfFieldMaxForegroundRadius, d.depthOfFieldScatterMaxRatio], [0.025, 0.1])
  assert.deepEqual([d.depthOfFieldTemporalQuality, d.depthOfFieldBilateralStrength], ['high', 0])
  const temporal = Object.keys(d).filter((name) => name.includes('Temporal'))
  assert.equal(temporal.length, 2, 'no filter size')
  for (const level of Object.values(DEPTH_OF_FIELD_PRESET_LEVELS))
    for (const name of Object.keys(level)) assert.ok(name in DEPTH_OF_FIELD_RULES, name)
})

// The depth of field's drawing is a family by rule (`DEPTH_OF_FIELD_RULES`): written once, in place after.
test('how the depth of field is drawn is the page’s setting, applied once each', () => {
  const written: unknown[][] = []
  const setters = { setDepthOfField: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ depthOfFieldQuality: 'off' }, () => runtime, { last: null })
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'off')
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'depthOfFieldQuality'),
    [['depthOfFieldQuality', 'off']],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.depthOfField = { depthOfFieldQuality: 'on' }
  switches.depthOfField = { depthOfFieldQuality: 'on' }
  assert.deepEqual(written, [['depthOfFieldQuality', 'on']], 'once, in place')
  switches.depthOfField = { depthOfFieldQuality: null }
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'on', 'given back: the preset’s')
  switches.depthOfField = { depthOfFieldQuality: false }
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'off')
  switches.depthOfField = { depthOfFieldQuality: true }
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'on')
  assert.throws(() => (switches.depthOfField = { depthOfFieldQuality: 'high' as never }), /high/)
  switches.settings.set('depthOfFieldQuality', 'off', 'quality')
  assert.equal(switches.depthOfField.depthOfFieldQuality, 'on', 'the page over the preset')
})

// What the settings decide of one image's draw: its plan, on a 1920 × 1080 image, a 40-degree field.
const planOf = (options: object, settings: object = {}, drawn: object = {}) =>
  planDepthOfField({
    cotHorizontal: 1.5455,
    cotVertical: 2.7474774,
    volume: resolveDepthOfField(options),
    settings: resolveSettings(DEPTH_OF_FIELD_RULES, settings),
    image: [1920, 1080],
    extent: [1920, 1080],
    display: [1920, 1080],
    near: 0.1,
    temporal: false,
    ...drawn,
  })
test('the plan draws nothing under a pixel of blur, and gathers the layers the circles need', () => {
  assert.equal(planOf({}).idle, true, 'no focus, no depth blur')
  assert.equal(planOf({ depthBlurRadius: 0.02 }).idle, true, 'a blur under 1/20 of a pixel')
  const lens = { focusDistance: 1, aperture: 1.2 }
  const wide = planOf(lens)
  assert.equal(`${wide.gather}/${tilesOf(wide)}/${wide.mips}`, '960,540/120,68/2')
  assert.equal(-cocRadiusAt(wide.coc, 0.1, 960), 24, 'held to the largest')
  assert.equal(wide.convolutions.map((c) => c.layer).join(), 'foreground,hole,slight,background')
  // Circles of 24 texels reach 4 tiles: a pass reads 3, so a second pass spreads the last one.
  assert.equal(
    wide.dilations.map((d) => d.mode + d.radius).join(),
    'minMax3,minMax1,minAbs3,minAbs1',
  )
  assert.equal(planOf({ depthBlurRadius: 6 }).convolutions.length, 3, 'a background alone')
  assert.deepEqual(planOf({ focusDistance: 5, aperture: 32 }).dilations, [
    { mode: 'standalone', radius: 1, multiplier: 1 },
  ])
  const full = planOf(lens, { depthOfFieldGatherDivisor: 1 })
  assert.deepEqual(full.gather, [1920, 1080])
  const up = planOf(lens, {}, { temporal: true, display: [3840, 2160] })
  const sizes = [up.gather, up.pre, up.reduced, circleRatio(up)].join('/')
  assert.equal(sizes, '960,540/1920,1080/1920,1080/0.5')
  const low = planOf(lens, { depthOfFieldAccumulator: 'low' })
  assert.deepEqual([low.mips, low.convolutions[0].quality], [wide.mips + 1, 0])
})
