// The first version of the standard output transform (`aces13Wgsl.ts`), the shipped WGSL run as
// JavaScript: held to the published code's own steps on the processor (`aces13Model.fixture.ts`),
// to the numbers the published code derives and writes down, and to values worked by hand from its
// source; then as a method of the table (`acesVersion`), with its gamut compression's share.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { near, nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { bakeRun } from '../toneBake.fixture.ts'
import { aces13Display, scaleAt, scaleOf } from './aces13Model.fixture.ts'
import { STANDARD_OUTPUT_13_WGSL } from './aces13Wgsl.ts'

type Shader = {
  aces13Display: (light: number[], multiplier: number, compression: number) => number[]
  aces13Ssts: (x: number) => number
  aces13Distance0: (dist: number) => number
  aces13Distance1: (dist: number) => number
  aces13Distance2: (dist: number) => number
  aces13Compress: (aces: number[]) => number[]
  aces13RedWeight: (centred: number) => number
}
const shader = shaderRun<Shader>(
  wgslModule(STANDARD_OUTPUT_13_WGSL),
  [
    'aces13Display',
    'aces13Ssts',
    'aces13Compress',
    'aces13RedWeight',
    ...[0, 1, 2].map((i) => `aces13Distance${i}`),
  ],
  { atan2: Math.atan2 },
)
/** The light of the scale's middle point: the 0.0822144598 the scale puts 4.8 nits at, over the
 *  multiplier 1.5 of the scene's light. */
const MIDDLE_GREY = 0.0822144598 / 1.5

test('the tone scale’s numbers are the ones the published code derives for a display of 10⁻⁴, 15 and 1000 nits', () => {
  // The numbers the published code writes down as the defaults of that display (the least and
  // greatest points, the middle point with its slope, the two splines' coefficients), to the single
  // precision they are written in.
  const written = scaleOf(1e-4, 15, 1000)
  const same = (got: number, want: number, what: string) => nearRelative(got, want, what, 2e-6)
  same(written.min.x, 2.5089862e-6, 'least light')
  same(written.min.y, 1e-4, 'least nits')
  same(written.max.x, 692.651123, 'greatest light')
  same(written.max.y, 1000, 'greatest nits')
  same(written.mid.x, 0.0822144598, 'middle light')
  same(written.mid.y, 4.8, 'middle nits')
  same(written.mid.slope, 1.55, 'middle slope')
  const coefficients = [
    [-4, -4, -3.15737653, -0.485249996, 1.84773231],
    [-0.33286342, 1.69534576, 2.75812411, 3, 3],
  ]
  coefficients.forEach((want, half) =>
    want.forEach((c, i) =>
      same((half ? written.high : written.low)[i], c, `coefficient ${half}.${i}`),
    ),
  )
})

test('the shader is the published steps: the sweeteners, the scale, the limit to the primaries, the compression by its share', () => {
  const lights = [
    [0.18, 0.18, 0.18],
    [1, 1, 1],
    [0.5, 0.1, 0.05],
    [0.05, 0.5, 0.1],
    [0.05, 0.1, 1],
    [5, 0.05, 0.05],
    [0.001, 0.002, 0.0005],
    [30, 10, 2],
    [2, 2, 0.01],
    [0.9, 0.02, 0.9],
    [0.3, 0.01, 0.3],
  ]
  for (const light of lights)
    for (const multiplier of [1.5, 0.4])
      for (const compression of [0, 0.5, 1])
        near(
          shader.aces13Display(light, multiplier, compression),
          aces13Display(light, multiplier, compression),
          `${light} × ${multiplier}, ${compression}`,
          2e-6,
        )
})

test('by hand: middle grey is the middle point, black is black, the top is white, the slope at the middle is the scale’s', () => {
  // The light the scale puts at its middle point comes out at the middle luminance: 4.8 nits of a
  // display range of 10⁻⁴ to 1000, so the share (4.8 − 10⁻⁴) / (1000 − 10⁻⁴) of the range, taken
  // back to nits by the range's top (the limit to the primaries changes nothing inside it) and to
  // the display's [0, 1] by a hundredth, the same on all three channels (the adaptation of the
  // encoding's white to sRGB's).
  const middle = ((4.8 - 1e-4) / (1000 - 1e-4)) * 1000 * 0.01
  near(
    shader.aces13Display([MIDDLE_GREY, MIDDLE_GREY, MIDDLE_GREY], 1.5, 0),
    [middle, middle, middle],
    'middle',
    1e-6,
  )
  // Nothing is nothing: the least light is the least luminance, which the share of the range takes
  // to 0 (a few units in the last place of the single-precision power of ten over). The greatest
  // light of the table, 100 times 1.5, is far over the luminance of 100 nits the display shows as
  // white.
  near(shader.aces13Display([0, 0, 0], 1.5, 0), [0, 0, 0], 'black', 1e-9)
  assert.deepEqual(shader.aces13Display([100, 100, 100], 1.5, 0), [1, 1, 1])
  near(shader.aces13Ssts(0), 1e-4, 'the least point is flat below', 1e-9)
  near(shader.aces13Ssts(1e6), 1000, 'the greatest point is flat above', 1e-6)
  // The slope of the scale at its middle point in the logarithms of the light and of the
  // luminance is the 1.55 it is given: the spline's first knot step is that slope times a third of
  // the span, whichever side it is read from.
  const e = 1e-4
  for (const [below, above] of [
    [0, 1],
    [-1, 0],
  ]) {
    const [x0, x1] = [below, above].map((side) => 0.0822144598 * (1 + side * e))
    const slope = Math.log10(shader.aces13Ssts(x1) / shader.aces13Ssts(x0)) / Math.log10(x1 / x0)
    nearRelative(slope, 1.55, `slope ${below}..${above}`, 2e-3)
  }
  assert.ok(
    Math.abs(scaleAt(0.0822144598, scaleOf(1e-4, 15, 1000)) - 4.8) < 1e-5,
    'the model agrees',
  )
})

test('by hand: the red modifier’s weight is a cubic spline of the hue, 1 at the red, a quarter half way to the edge, 0 from the edge', () => {
  // The width is 135 degrees, in four knot steps of 33.75: at the red the spline is on its third
  // segment's start, 2 / 3 of the basis, which the factor 1.5 takes to 1; a step away it is
  // 1 / 6 of it, 0.25; at and past the edge, nothing.
  const weight = shader.aces13RedWeight
  near([weight(0), weight(-33.75), weight(33.75)], [1, 0.25, 0.25], 'the red and a step', 1e-6)
  near([weight(-67.5), weight(67.5), weight(120), weight(-180)], [0, 0, 0, 0], 'the edge', 0)
  near(weight(-16.875), weight(16.875), 'symmetric', 1e-6)
})

test('by hand: the gamut compression leaves the achromatic and the near, and takes each limit to 1', () => {
  // A distance under the threshold is its own; the limit is taken to exactly 1 by the scale the
  // curve is given: with n = (limit − threshold) / scale, n^p = ((1 − threshold) / (limit −
  // threshold))^−p − 1, so 1 + n^p to the power 1 / p is (limit − threshold) / (1 − threshold) and
  // the compressed distance is threshold + (1 − threshold) = 1.
  assert.equal(shader.aces13Distance0(0.5), 0.5)
  assert.equal(shader.aces13Distance1(0.8), 0.8)
  assert.equal(shader.aces13Distance2(0), 0)
  near(shader.aces13Distance0(1.147), 1, 'cyan', 1e-6)
  near(shader.aces13Distance1(1.264), 1, 'magenta', 1e-6)
  near(shader.aces13Distance2(1.312), 1, 'yellow', 1e-6)
  // It never turns back: a larger distance is a larger compressed one.
  const through = (at: number) => shader.aces13Distance0(0.815 + at * 0.4)
  for (let at = 0; at < 1; at += 0.05) assert.ok(through(at + 0.05) > through(at), `rises at ${at}`)
  // A colour on the achromatic axis, or with a negative channel, is left as it is.
  near(shader.aces13Compress([0.3, 0.3, 0.3]), [0.3, 0.3, 0.3], 'achromatic', 1e-6)
  assert.deepEqual(shader.aces13Compress([-0.1, 0.5, 0.2]), [-0.1, 0.5, 0.2])
  // A colour, a share of its compression: none leaves the light, all of it is the compression.
  const bright = [0.3, 0.01, 0.3]
  const none = shader.aces13Display(bright, 1.5, 0),
    half = shader.aces13Display(bright, 1.5, 0.5),
    all = shader.aces13Display(bright, 1.5, 1)
  assert.ok(
    none.some((c, i) => Math.abs(c - all[i]) > 1e-4),
    'the compression changes this colour',
  )
  assert.ok(
    half.some((c, i) => Math.abs(c - none[i]) > 1e-5 && Math.abs(c - all[i]) > 1e-5),
    'half is between',
  )
})

test('as a method of the table: the first version, the second by default, the compression read only by the first', () => {
  const R = TONE_MAPPING_RANK.filmic
  const first = bakeRun({ tonemappingMethod: 'standardAces', acesVersion: 1 }, R)
  const second = bakeRun({ tonemappingMethod: 'standardAces' }, R)
  assert.deepEqual([...first.bake.aces], [1, 1.5, 1, 0], 'version 1, no compression')
  assert.deepEqual([...second.bake.aces], [1, 1.5, 0, 0], 'version 2 by default')
  // The table's colour of a neutral light of the middle point is that point, through the display's
  // power 2.4 the method shows by default: (the middle luminance over a hundred)^(1 / 2.4).
  const light = [MIDDLE_GREY, MIDDLE_GREY, MIDDLE_GREY]
  const expected = (((4.8 - 1e-4) / (1000 - 1e-4)) * 10) ** (1 / 2.4)
  const shown = first.displayLight(light)
  near(shown, [expected, expected, expected], 'the middle', 1e-5)
  const other = second.displayLight(light)
  assert.ok(Math.abs(other[0] - shown[0]) > 1e-3, 'the second version shows another colour')
  // The share of the compression reaches the first version's table and no other.
  const squeezed = bakeRun(
    { tonemappingMethod: 'standardAces', acesVersion: 1, acesGamutCompression: 0.5 },
    R,
  )
  assert.deepEqual([...squeezed.bake.aces], [1, 1.5, 1, 0.5])
  const ignored = bakeRun({ tonemappingMethod: 'standardAces', acesGamutCompression: 0.5 }, R)
  assert.deepEqual([...ignored.bake.aces], [1, 1.5, 0, 0], 'the second version reads none')
  const bright = [0.3, 0.01, 0.3]
  assert.ok(
    squeezed
      .displayLight(bright)
      .some((c, i) => Math.abs(c - first.displayLight(bright)[i]) > 1e-4),
  )
  assert.deepEqual(ignored.displayLight(bright), second.displayLight(bright))
  // Not the standard output transform: no version is asked for, whatever the settings say.
  const film = bakeRun({ acesVersion: 1, acesGamutCompression: 1 }, R)
  assert.deepEqual([...film.bake.aces].slice(0, 2), [0, 1.5])
  // The switch of the grading leaves the version and the compression, as it leaves the multiplier.
  const off = bakeRun(
    {
      tonemappingMethod: 'standardAces',
      acesVersion: 1,
      acesGamutCompression: 0.25,
      applyColorGrading: false,
    },
    R,
  )
  assert.deepEqual(
    [...off.bake.aces],
    [0, 1.5, 1, 0.25],
    'the method is the switch’s, the version not',
  )
})
