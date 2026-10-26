// The table the display value is baked into (`toneBakeWgsl.ts`), the shipped WGSL run as JavaScript: at its
// defaults it is the display curve, and each setting of the white balance, the grade, the correction,
// the display's transfer does what the reference's says (the method that is the standard output
// transform is `aces/acesDisplay.test.ts`'s).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb, srgbToLinear } from '../../../math/src/color/color.ts'
import { DISPLAY_VALUE_WGSL } from './toneMappingWgsl.ts'
import { bakeRun } from './toneBake.fixture.ts'
import { EXPOSURE_MIDDLE_GREY } from '../../../sdk-core/src/contracts/exposureOptions.ts'
import { balances, whiteBalanceMatrix } from './whiteBalance.ts'
import { multiply3 } from '../../../math/src/matrix/matrix3.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import type { ColorGradingSettings } from '../../../sdk-core/src/contracts/colorGradingOptions.ts'

type Curve = (c: number[]) => number[]
const run = shaderRun<{
  filmicCurve: Curve
  displayValue: (c: number[], curve: number) => number[]
}>(
  wgslModule(DISPLAY_VALUE_WGSL),
  ['filmicCurve', 'displayValue'],
  // The film curve reads the hue as an angle; the interpreter's built-ins hold no `atan2`.
  { atan2: Math.atan2 },
)

const R = TONE_MAPPING_RANK

// The film curve on a grey, middle grey and the greys around it, against what the film response
// gives: a grey goes through the curve of one channel alone, and middle grey stays middle grey.
test('the film curve gives the greys of the film response', () => {
  const grey = [
    [0.01, 0.0017],
    [0.05, 0.025],
    [0.18, 0.18],
    [0.36, 0.402],
    [0.72, 0.634],
    [1, 0.723],
    [2, 0.862],
  ]
  for (const [radiance, shown] of grey) {
    const out = run.filmicCurve([radiance, radiance, radiance])
    for (const channel of out)
      assert.ok(Math.abs(channel - shown) < 6e-4, `${radiance}: ${channel}`)
  }
})

test('a light the curve does not define shows 0 on the path that reads no table, as the table stores it', () => {
  // The film curve of a black light divides by nothing's luminance and takes a minus infinity's logarithm: a value
  // that is not a number, which the reference's unsigned targets write 0 and `displayValue` writes 0 too.
  for (const rank of [R.filmic, R.none]) {
    assert.deepEqual(run.displayValue([0, 0, 0], rank), [0, 0, 0], `black, curve ${rank}`)
    assert.deepEqual(run.displayValue([NaN, 0.2, NaN], rank).map(Number.isNaN), [
      false,
      false,
      false,
    ])
    assert.equal(run.displayValue([NaN, 0.2, NaN], rank)[0], 0, `a NaN light: 0, curve ${rank}`)
  }
  assert.deepEqual(run.displayValue([Infinity, -Infinity, NaN], R.none), [1, 0, 0])
  // The finite values are as they were: a light the curve defines goes through unchanged.
  near(run.displayValue([0.18, 0.18, 0.18], R.filmic), [0.4607, 0.4607, 0.4607], 'grey', 2e-3)
})

/** The table's colour for the light `light` under the curve `rank`, through its code and back, so
 *  that no interpolation is in it, scaled back by the table's scale: the display value the table
 *  holds for that light. */
const tableFor = (settings: ColorGradingSettings, rank: number, light: number[]) => {
  const table = bakeRun(settings, rank)
  return table.tableColor(table.shaperCode(light, 0)).map((v) => v * table.bake.device[3])
}
const greyAt = (value: number) => [value, value, value]

test('the baked table, at its defaults, is the display curve: every curve, over lights the film curve keeps under white', () => {
  const lights = [
    greyAt(0.002),
    greyAt(0.05),
    greyAt(0.18),
    greyAt(0.9),
    [0.4, 0.1, 0.05],
    [0.02, 0.3, 0.1],
  ]
  for (const [name, rank] of Object.entries(R))
    if (rank !== R.none)
      for (const light of lights)
        near(tableFor({}, rank, light), run.displayValue(light, rank), `${name} ${light}`, 1e-6)
})

test('the white balance takes a temperature’s white to the display’s, or the display’s to it, and none at the neutral pair', () => {
  assert.ok(!balances(6500, 0) && balances(6500, 0.1) && balances(6400, 0))
  const [cool, warm] = [whiteBalanceMatrix(3000, 0, false), whiteBalanceMatrix(3000, 0, true)]
  const identity = multiply3(cool, warm)
  near(identity, [1, 0, 0, 0, 1, 0, 0, 0, 1], 'the two readings undo each other', 1e-6)
  // A light taken for orange loses red and gains blue; read the other way, the image warms.
  const grey = (m: number[]) => [m[0] + m[3] + m[6], m[1] + m[4] + m[7], m[2] + m[5] + m[8]]
  assert.ok(grey(cool)[0] < grey(cool)[2] && grey(warm)[0] > grey(warm)[2])
  const [balanced, plain] = [
    tableFor({ whiteTemperature: 3000 }, R.filmic, greyAt(0.3)),
    tableFor({}, R.filmic, greyAt(0.3)),
  ]
  assert.ok(balanced[2] > plain[2] && balanced[0] < plain[0], 'the table turns a grey bluer')
})

test('each operation of the grade does its own work, over the zone it is set for', () => {
  const at = (settings: ColorGradingSettings, light: number[], rank: number = R.filmic) =>
    tableFor(settings, rank, light)
  const same = (a: number[], b: number[], label: string) => near(a, b, label, 1e-6)
  // A grey is the film curve's channel curve alone, so the grade's effect is the light it gives it.
  same(at({ colorGainMaster: 2 }, greyAt(0.2)), at({}, greyAt(0.4)), 'gain')
  same(at({ colorOffsetMaster: 0.05 }, greyAt(0.01)), at({}, greyAt(0.06)), 'offset')
  // A light of exactly 0 has no chroma to expand (0 over 0): the texel is not a number and is stored 0, offset or not, as the
  // reference's table stores it.
  same(at({ colorOffsetMaster: 0.05 }, greyAt(0)), greyAt(0), 'a black light stays black')
  same(at({ colorContrastMaster: 2 }, greyAt(0.36)), at({}, greyAt(0.72)), 'contrast, about 0.18')
  same(at({ colorGammaMaster: 2 }, greyAt(0.25)), at({}, greyAt(0.5)), 'gamma, the power 1/2')
  const red = at({ colorGainRed: 2 }, [0.1, 0.1, 0.1])
  assert.ok(red[0] > at({}, [0.1, 0.1, 0.1])[0], 'a channel of the gain')
  const grey = at({ colorSaturationMaster: 0 }, [2, 0.2, 0.1])
  near([grey[0] - grey[1], grey[1] - grey[2]], [0, 0], 'a saturation of 0 is the luminance', 1e-5)
  // The bright part alone: a dark light, whose bright share is nothing, is untouched; a light
  // above the bright part's top is the whole light's grade.
  const bright = { colorGainHighlightsMaster: 2 }
  same(at(bright, greyAt(0.0005)), at({}, greyAt(0.0005)), 'the dark part is not graded')
  same(at(bright, greyAt(3)), at({}, greyAt(6)), 'the bright part is')
  // The bounds of the parts may meet: no light reads a NaN.
  const met = at(
    { colorCorrectionHighlightsMin: 0.5, colorCorrectionHighlightsMax: 0.5 },
    greyAt(0.5),
  )
  assert.ok(met.every(Number.isFinite))
  same(
    at({ applyColorGrading: false, colorSaturationMaster: 0 }, [2, 0.2, 0.1]),
    at({}, [2, 0.2, 0.1]),
    'off',
  )
})

test('the grade’s parts are smooth steps for any order of their bounds, and a number of 0 stores 0, never NaN', () => {
  const at = (settings: ColorGradingSettings, light: number[]) =>
    tableFor(settings, R.filmic, light)
  // Crossed bounds: the dark part's weight is 1 for every light above 0 — the whole image takes its
  // gain of 2, where a floor on the bound turned the part off.
  const crossed = { colorGainShadowsMaster: 2, colorCorrectionShadowsMax: -0.5 }
  for (const grey of [0.05, 0.2, 0.6])
    near(
      at(crossed, greyAt(grey)),
      at({ colorGainMaster: 2 }, greyAt(grey)),
      `crossed ${grey}`,
      1e-6,
    )
  // A bright part that starts above where it is whole is a reversed ramp, then a step where they meet.
  const grade = (min: number, max: number) =>
    bakeRun(
      {
        colorGainHighlightsMaster: 2,
        colorCorrectionHighlightsMin: min,
        colorCorrectionHighlightsMax: max,
      },
      R.filmic,
    ).colorCorrectAll
  const [reversed, met] = [grade(0.8, 0.4), grade(0.5, 0.5)]
  assert.ok(reversed(greyAt(0.1))[0] > 1.9 * 0.1 * 0.99 && reversed(greyAt(0.9))[0] < 1.1 * 0.9)
  assert.ok(met(greyAt(0.4))[0] < 0.41 && met(greyAt(0.6))[0] > 1.19)
  // A gamma of 0 divides by it: the unsigned table the reference stores gives such a texel 0, so
  // the float table holds none that is not a number, which trilinear reading would spread.
  const zero = bakeRun({ colorGammaMaster: 0 }, R.filmic)
  for (const code of [0, 0.3, 0.5, 0.7, 0.9, 1])
    assert.ok(
      zero.tableColor(greyAt(code)).every((v) => v >= 0 && v <= 1),
      `code ${code}`,
    )
  assert.equal(
    bakeRun({ colorGammaRed: 0 }, R.filmic).tableColor(greyAt(0.8)).some(Number.isNaN),
    false,
  )
})

test('the table’s scale is 1.05 for the film curve and 1 under an explicit gamma or no curve', () => {
  const scale = (settings: ColorGradingSettings, rank: number) =>
    bakeRun(settings, rank).bake.device[3]
  assert.equal(scale({}, R.filmic), Math.fround(1.05))
  assert.equal(scale({ tonemapperGamma: 2.2 }, R.filmic), 1)
  assert.equal(scale({}, R.none), 1)
})

test('the correction and the display’s transfer follow the film curve in the order the reference has them', () => {
  const film = (light: number[]) => tableFor({}, R.filmic, light).map(srgbToLinear)
  const lit = [0.4, 0.1, 0.05]
  const base = film(lit)
  const show = (settings: ColorGradingSettings) => tableFor(settings, R.filmic, lit)
  // The polynomial a x² + b x + c through (0, min), (0.5, mid), (1, max): here half the light.
  near(
    show({ colorMid: 0.25, colorMax: 0.5 }),
    base.map((x) => linearToSrgb(0.5 * x)),
    'polynomial',
    1e-6,
  )
  near(
    show({ displayGamma: 1.1 }),
    base.map((x) => linearToSrgb(x ** 2)),
    'the ratio 2.2 over the gamma',
    1e-6,
  )
  near(
    show({ tonemapperGamma: 2.2 }),
    base.map((x) => x ** (1 / 2.2)),
    'an explicit gamma',
    1e-6,
  )
  // A gamma under 1 is read as 1: the linear light is the display value, no transfer at all (as the meaning says).
  near(show({ tonemapperGamma: 0.5 }), base, 'a gamma under 1 is read as 1', 1e-6)
  near(show({ tonemapperGamma: 1 }), base, 'a gamma of 1: no transfer', 1e-6)
  near(
    show({ sdrInverseEotf: 'bt1886' }),
    base.map((x) => x ** (1 / 2.4)),
    'the power 2.4',
    1e-6,
  )
  // Only the film curve is corrected: no curve ignores the polynomial and the gamma ratio.
  near(
    tableFor({ colorMax: 0.5, displayGamma: 1.1 }, R.none, lit),
    tableFor({}, R.none, lit),
    'none',
    1e-9,
  )
})

test('the shaper is the logarithm or the quantizer: a light addresses the table, and its code gives it back', () => {
  const table = bakeRun({}, R.filmic)
  for (const shaper of [0, 1])
    for (const light of [0.0001, 0.18, 1, 20, shaper ? 90 : 40]) {
      const code = table.shaperCode(greyAt(light), shaper)
      assert.ok(
        code.every((v) => v > 0 && v <= 1),
        `${shaper} ${light}`,
      )
      // Within the single-precision literals the text is written with: 1e-6 of the light and the
      // table's black.
      near(
        table.shaperLight(code, shaper),
        greyAt(light),
        `${shaper} ${light}`,
        1e-6 * (light + 0.003),
      )
    }
  near(table.shaperCode(greyAt(0), 0), greyAt(0), 'a light of 0 is the first texel', 1e-12)
  // The one middle grey, the exposure's: the code 444 of 1023 is 0.18 less the table's black, 14 stops under.
  assert.equal(EXPOSURE_MIDDLE_GREY, 0.18)
  near(
    table.shaperLight(greyAt(444 / 1023), 0),
    greyAt(EXPOSURE_MIDDLE_GREY * (1 - 2 ** (-14 * (444 / 1023)))),
    'middle grey',
    1e-6,
  )
})
