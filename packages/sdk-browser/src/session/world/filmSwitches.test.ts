import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MeasuredWorld } from '../explorer.ts'
import { sessionOptions } from './options.ts'
import { worldSwitches } from './switches.ts'
import {
  COLOR_GRADING_RULES,
  GRADE_FIELDS,
} from '../../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'

/** No frame drawn yet. */
const unseen = { last: null }

// The film effects' settings are a family by rule (`FILM_RULES`), in the image effects' quality group:
// the page's are written into the session once opened and, after, in place; a preset writes two.
test('the film effects are the page’s setting, applied once each, over the preset’s', () => {
  const written: unknown[][] = []
  const setters = { setFilm: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ filmGrainIntensity: 0.3 }, () => runtime, unseen)
  assert.deepEqual(
    [switches.film.filmGrainIntensity, switches.film.filmGrainShadowsMax],
    [0.3, 0.09],
    'the page’s grain, the reference’s default for the rest',
  )
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'filmGrainIntensity'),
    [['filmGrainIntensity', 0.3]],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.film = { chromaticAberration: 2 }
  switches.film = { chromaticAberration: 2 }
  assert.deepEqual(written, [['chromaticAberration', 2]], 'once, in place')
  switches.film = { chromaticAberration: null }
  assert.equal(switches.film.chromaticAberration, 0, 'given back: the default, off')
  // A preset writes the tonemapper's quality and the fringe's; the page's setting holds over it.
  switches.quality.preset = 'smooth'
  assert.deepEqual(
    [switches.film.tonemapperQuality, switches.film.chromaticAberrationQuality],
    [0, 'off'],
  )
  switches.film = { tonemapperQuality: 5, chromaticAberrationQuality: true }
  assert.deepEqual(
    [switches.film.tonemapperQuality, switches.film.chromaticAberrationQuality],
    [5, 'high'],
  )
  assert.throws(() => (switches.film = { tonemapperQuality: 6 }), /tonemapperQuality/)
})

// The colour grading's settings are a family by rule (`COLOR_GRADING_RULES`), in the same group, written
// into the session once opened and in place after; no preset writes one (the reference's rows are the defaults).
test('the colour grading is the page’s setting, applied once each; no preset moves it', () => {
  const written: unknown[][] = []
  const setters = { setColorGrading: (...write: unknown[]) => void written.push(write) }
  const get = (held: typeof setters, name: string) => held[name as keyof typeof held] ?? (() => {})
  const explorer = new Proxy(setters, { get }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ whiteTemperature: 5000 }, () => runtime, unseen)
  const { colorGrading } = switches
  assert.deepEqual([colorGrading.whiteTemperature, colorGrading.filmSlope], [5000, 0.88])
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'whiteTemperature'),
    [['whiteTemperature', 5000]],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.colorGrading = { colorGainMaster: 1.2 }
  switches.colorGrading = { colorGainMaster: 1.2 }
  assert.deepEqual(written, [['colorGainMaster', 1.2]], 'once, in place')
  switches.colorGrading = { colorGainMaster: null }
  assert.equal(switches.colorGrading.colorGainMaster, 1, 'given back: the default')
  for (const preset of ['smooth', 'balanced', 'fine', 'max'] as const) {
    switches.quality.preset = preset
    assert.equal(switches.colorGrading.lutSize, 32, `${preset} writes none`)
  }
  assert.throws(() => (switches.colorGrading = { blueCorrection: 2 }), /blueCorrection/)
})

test('the colour grading is the reference’s defaults: the film curve’s own numbers, no balance, no grade, a table of 32 texels', () => {
  const values = resolveSettings(COLOR_GRADING_RULES, {})
  const grade = Object.entries(values).filter(([field]) =>
    /^color(Saturation|Contrast|Gamma|Gain|Offset)/.test(field),
  )
  assert.equal(grade.length, 80, 'five operations, four zones, four numbers')
  // The one list of the grade's numbers: in the order of the baking's vectors, the zone times five plus the operation.
  assert.equal(new Set(GRADE_FIELDS.map(({ field }) => field)).size, 80)
  assert.deepEqual(
    GRADE_FIELDS.map(({ field }) => field).sort(),
    grade.map(([field]) => field).sort(),
  )
  assert.deepEqual(
    [GRADE_FIELDS[0].field, GRADE_FIELDS[4].field, GRADE_FIELDS[79].field],
    ['colorSaturationRed', 'colorContrastRed', 'colorOffsetHighlightsMaster'],
  )
  const gain = GRADE_FIELDS.find(
    (f) => f.operation === 'Gain' && f.zone === 'Shadows' && f.channel === 'Blue',
  )
  assert.equal(gain?.field, 'colorGainShadowsBlue')
  for (const [field, value] of grade)
    assert.equal(value, field.startsWith('colorOffset') ? 0 : 1, field)
  const graded = new Set(grade.map(([field]) => field))
  const others = Object.fromEntries(Object.entries(values).filter(([field]) => !graded.has(field)))
  assert.deepEqual(others, {
    ...{ tonemappingMethod: 'filmic', acesSceneColorMultiplier: 1.5 },
    ...{ acesVersion: 2, acesGamutCompression: 0 },
    ...{
      filmSlope: 0.88,
      filmToe: 0.55,
      filmShoulder: 0.26,
      filmBlackClip: 0,
      filmWhiteClip: 0.04,
    },
    ...{ blueCorrection: 0.6, expandGamut: 1, toneCurveAmount: 1, temperatureType: 'whiteBalance' },
    ...{ whiteTemperature: 6500, whiteTint: 0, colorCorrectionShadowsMax: 0.09 },
    ...{ colorCorrectionHighlightsMin: 0.5, colorCorrectionHighlightsMax: 1 },
    ...{ colorMin: 0, colorMid: 0.5, colorMax: 1, applyColorGrading: true, displayGamma: 2.2 },
    ...{ tonemapperGamma: 0, sdrInverseEotf: 'default', lutSize: 32, lutShaper: 'log' },
  })
  // A limit only where a value would divide by zero: a slope of 0 does; a temperature of 0, a
  // negative slope, a table of any size and a negative multiplier of the method's light do not.
  const bad = [{ blueCorrection: 1.5 }, { colorMax: 11 }, { lutSize: 1 }, { displayGamma: 0 }]
  const acesBad = [{ acesVersion: 3 }, { acesVersion: 0 }, { acesVersion: 1.5 }]
  for (const options of [
    ...[...bad, ...acesBad, { acesGamutCompression: 1.5 }, { acesGamutCompression: -0.1 }],
    ...[{ filmSlope: 0 }, { acesSceneColorMultiplier: -1 }],
  ])
    assert.throws(() => resolveSettings(COLOR_GRADING_RULES, options))
  const open = [{ whiteTemperature: 0 }, { filmSlope: -0.5 }, { lutSize: 1024 }]
  const aces = {
    tonemappingMethod: 'standardAces',
    acesVersion: 1,
    acesGamutCompression: 0.5,
  } as const
  for (const options of [
    ...open,
    aces,
    { tonemappingMethod: 'standardAces', sdrInverseEotf: 'srgb' } as const,
  ])
    assert.doesNotThrow(() => resolveSettings(COLOR_GRADING_RULES, options))
})
