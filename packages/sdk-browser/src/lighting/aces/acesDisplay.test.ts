// The standard output transform (`acesWgsl.ts`), the shipped WGSL run as JavaScript: held to its CPU twin
// (`acesGamutModel.fixture.ts`), the hue tables it reads held to the ones made from the display's gamut
// (`acesTables.fixture.ts`), and the method it is in the baked table: the film curve's place, the power
// 2.4 and its own multiplier, the film curve's settings not reaching it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb } from '../../../../math/src/color/color.ts'
import { mix } from '../../../../math/src/scalar/reals.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import type { ColorGradingSettings } from '../../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { bakeRun } from '../toneBake.fixture.ts'
import { acesDisplay, cuspAt, reachAt } from './acesGamutModel.fixture.ts'
import { tablesFor } from './acesTables.fixture.ts'
import { SDR_TABLES } from './acesTables.ts'
import { STANDARD_OUTPUT_WGSL } from './acesWgsl.ts'

const R = TONE_MAPPING_RANK
/** The table's colour for the light `light` under the curve `rank`, through its code and back,
 *  scaled back by the table's scale: the display value the table holds for that light. */
const tableFor = (settings: ColorGradingSettings, rank: number, light: number[]) => {
  const table = bakeRun(settings, rank)
  return table.tableColor(table.shaperCode(light, 0)).map((v) => v * table.bake.device[3])
}

test('the standard output transform’s shader is its CPU twin, and its hue tables are the ones made from the display’s gamut', () => {
  const shader = shaderRun<{ acesDisplay: (light: number[], multiplier: number) => number[] }>(
    wgslModule(STANDARD_OUTPUT_WGSL),
    ['acesDisplay'],
    { atan2: Math.atan2 },
  )
  const lights = [
    [0.18, 0.18, 0.18],
    [1, 1, 1],
    [0.5, 0.1, 0.05],
    [0.05, 0.5, 0.1],
    [0.05, 0.1, 1],
  ]
  for (const light of [
    ...lights,
    [5, 0.05, 0.05],
    [0.001, 0.002, 0.0005],
    [30, 10, 2],
    [2, 2, 0.01],
  ])
    for (const multiplier of [1.5, 0.4])
      near(
        shader.acesDisplay(light, multiplier),
        acesDisplay(light, multiplier),
        `${light} × ${multiplier}`,
        1e-6,
      )
  // Grey stays grey, black stays black, and the display's white is reached from a light of 100.
  assert.deepEqual(acesDisplay([0, 0, 0], 1.5), [0, 0, 0])
  near(acesDisplay([100, 100, 100], 1.5), [1, 1, 1], 'white', 1e-9)
  const made = tablesFor(100)
  const close = (got: readonly number[], want: readonly number[], what: string) =>
    got.forEach((x, i) =>
      assert.ok(Math.abs(x - want[i]) <= 2e-6 * Math.max(1, Math.abs(want[i])), `${what} ${i}`),
    )
  close(SDR_TABLES.reach, made.reach, 'reach')
  close(SDR_TABLES.cusp.flat(), made.cusp.flat(), 'cusp')
  close(SDR_TABLES.gamma, made.gamma, 'gamma')
  assert.ok(
    made.gamma.every((g) => g > 0),
    'every hue found its curvature',
  )
})

test('the standard output transform is the film curve’s place, with the power 2.4 and its own multiplier; the film curve’s settings do not reach it', () => {
  const method: ColorGradingSettings = { tonemappingMethod: 'standardAces' }
  const grey = (g: number) => [g, g, g]
  for (const g of [0.05, 0.18, 1, 6]) {
    const owed = acesDisplay(grey(g), 1.5).map((x) => x ** (1 / 2.4))
    near(tableFor(method, R.filmic, grey(g)), owed, `grey ${g}`, 1e-5)
  }
  near(
    tableFor({ ...method, sdrInverseEotf: 'srgb' }, R.filmic, grey(0.18)),
    acesDisplay(grey(0.18), 1.5).map(linearToSrgb),
    'sRGB asked',
    1e-5,
  )
  near(
    tableFor({ ...method, acesSceneColorMultiplier: 3 }, R.filmic, grey(0.18)),
    acesDisplay(grey(0.18), 3).map((x) => x ** (1 / 2.4)),
    'multiplier',
    1e-5,
  )
  const filmOnly = {
    filmSlope: 1.3,
    filmToe: 0.3,
    blueCorrection: 0,
    colorMax: 0.5,
    colorMin: 0.1,
    displayGamma: 1.1,
    toneCurveAmount: 0.2,
  }
  const lit = [0.4, 0.1, 0.05]
  near(
    tableFor({ ...method, ...filmOnly }, R.filmic, lit),
    tableFor(method, R.filmic, lit),
    'film settings',
    1e-12,
  )
  // What is before the method does reach it: the grade, the white balance, the expansion of the gamut.
  for (const reaching of [{ colorGainMaster: 2 }, { whiteTemperature: 4500 }, { expandGamut: 0 }])
    assert.ok(
      tableFor({ ...method, ...reaching }, R.filmic, lit).some(
        (x, c) => Math.abs(x - tableFor(method, R.filmic, lit)[c]) > 1e-3,
      ),
      JSON.stringify(reaching),
    )
  // The table ends at 1 and not 1.05; the switch gives the film curve back.
  assert.equal(bakeRun(method, R.filmic).bake.device[3], 1)
  near(
    tableFor({ ...method, applyColorGrading: false }, R.filmic, lit),
    tableFor({}, R.filmic, lit),
    'switched off',
    1e-12,
  )
})

test('the grading gamut’s reach is continuous all round the hue circle: the weight of the upper entry is the distance past the lower, the wrap included', () => {
  const reach = SDR_TABLES.reach
  const { acesReachAt } = shaderRun<{ acesReachAt: (h: number) => number }>(
    wgslModule(STANDARD_OUTPUT_WGSL),
    ['acesReachAt'],
    {},
  )
  // The reference's weight, `(h − low) / (high − low)`, which at the wrap divides by −359.
  const referenced = (h: number) => {
    const low = Math.trunc(h),
      high = (low + 1) % 360
    return mix(reach[low], reach[high], (h - low) / (high - low))
  }
  const step = Math.abs(reach[0] - reach[359])
  // (1) Across the wrap: at 359.999 and at 0 the value differs by the table's own rate over 0.001 degree
  //     (the reference's jumps by the whole step: its value at 359.999 is still the 359° entry's).
  const here = reachAt(359.999, reach)
  assert.ok(Math.abs(here - reachAt(0, reach)) <= 0.0011 * step, `${here}`)
  assert.ok(Math.abs(referenced(359.999) - reachAt(0, reach)) > 0.99 * step, 'the reference jumps')
  assert.equal(reachAt(360 - 1e-12, reach) > Math.min(reach[0], reach[359]) - 1e-9, true)
  // (2) The band 359 to 360 is the only one that differs from the reference's: by up to the whole step.
  let widest = 0
  for (let k = 0; k < 1000; k++)
    widest = Math.max(widest, Math.abs(reachAt(359 + k / 1000, reach) - referenced(359 + k / 1000)))
  assert.ok(widest > 0.99 * step && widest < 1.01 * step, `${widest} against a step of ${step}`)
  // (3) Everywhere else it is the reference's value to the bit; the shader's equals the processor's.
  for (let k = 0; k < 359000; k += 7)
    assert.equal(reachAt(k / 1000, reach), referenced(k / 1000), `${k / 1000}`)
  for (const h of [0, 12.34, 180, 358.999, 359, 359.5, 359.999, 720.25, -0.5])
    near([acesReachAt(h)], [reachAt(h, reach)], `shader ${h}`, 1e-4)
})

test('the cusp of the display gamut is read between the two entries a hue lies between, with no clamp on the search: every hue, the table’s ends included', () => {
  const table = SDR_TABLES.cusp
  for (let thousandths = 0; thousandths < 360000; thousandths += 7) {
    const hue = thousandths / 1000
    // The brute-force bracket: the last entry not above the hue, and the one after it.
    let low = 0
    while (low + 1 < table.length - 1 && table[low + 1][2] < hue) low++
    const [lo, hi] = [table[low], table[low + 1]]
    const t = (hue - lo[2]) / (hi[2] - lo[2])
    const [j, m] = cuspAt(hue, table)
    assert.ok(
      Math.abs(j - mix(lo[0], hi[0], t)) < 1e-9 && Math.abs(m - mix(lo[1], hi[1], t)) < 1e-9,
      `${hue}`,
    )
  }
})
