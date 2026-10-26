// The background the screen draws where nothing else is, as scene radiance: the lighting writes it into the lit image
// (`surfaceColourMain`, the shipped WGSL run as JavaScript) with the fog over it (`heightFogMain`), and a mirror that sees it
// adds the same radiance (`createSurroundings`), both shown by the table of the colour settings at the exposure the view has.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { srgbToLinear } from '../../../../math/src/color/color.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { SURFACE_COLOUR_ENTRY, SURFACE_COLOUR_WGSL } from '../deferred/colourPassWgsl.ts'
import { HEIGHT_FOG_ENTRY, heightFogWgsl } from '../fog/fogPassWgsl.ts'
import { bakeRun } from '../toneBake.fixture.ts'
import { createSurroundings } from './surroundings.ts'

test('the background is scene radiance: the lighting writes it into the lit image and a mirror adds it, both through the table, graded or not', () => {
  const clear = 0x171d28
  const bytes = [0x17, 0x1d, 0x28].map((c) => c / 255)
  const surroundings = [...createSurroundings()(clear).slice(0, 3)]
  near(surroundings, bytes.map(srgbToLinear), 'the colour read as the sRGB values it is', 1e-7)
  // The lighting's empty pixel (`surfaceColourMain`, a surface flag of zero) over a view with no fog, then the fog pass over it
  // (`heightFogMain`, blended premultiplied: one / one minus the source alpha): its inscattering and the background through its transmittance, the image's
  // pre-exposure applied.
  const view = {
    viewport: [0, 0, 0, 0],
    background: [...bytes, 1],
    camera: [0, 0, 0, 1],
    display: [1, 0, 0, 0],
    preExposure: [0.5, 1, 0, 0],
    views: [0, 0, 0, 0],
  }
  let fog = false
  const empty = { textureLoad: () => [0, 0, 0, 0], words: {}, colours: {}, depth: {} }
  const { [SURFACE_COLOUR_ENTRY]: colour } = shaderRun<
    Record<string, (pixel: number[]) => number[]>
  >(wgslModule(SURFACE_COLOUR_WGSL), [SURFACE_COLOUR_ENTRY, 'preExposed'], { view, ...empty })
  const { [HEIGHT_FOG_ENTRY]: fogged } = shaderRun<Record<string, (pixel: number[]) => number[]>>(
    wgslModule(heightFogWgsl(false)),
    [HEIGHT_FOG_ENTRY, 'preExposed'],
    {
      view,
      ...empty,
      directLights: { atmosphere: [[0, 0, 0, 0]] },
      fogsBackground: () => fog,
      worldAt: () => [0, 0, 1],
      fogBeyondAt: () => [0.01, 0.02, 0.03, 0.25],
    },
  )
  const direct = colour([4, 4])
  near(
    direct,
    [...surroundings.map((c) => c * 0.5), 1],
    'the background, the pre-exposure applied, nothing of it hidden',
    1e-7,
  )
  fog = true
  const over = fogged([4, 4])
  const lit = direct.map((c, i) => (i < 3 ? over[i] + c * (1 - over[3]) : c))
  near(
    lit,
    [
      0.01 * 0.5 + surroundings[0] * 0.125,
      0.02 * 0.5 + surroundings[1] * 0.125,
      0.03 * 0.5 + surroundings[2] * 0.125,
      1,
    ],
    'the fog',
    1e-7,
  )
  view.viewport[2] = 1
  assert.deepEqual(
    colour([4, 4]),
    [...bytes, 1],
    'the raw output of a diagnostic view takes it as it is',
  )
  view.background[3] = 0.25
  assert.equal(colour([4, 4])[3], 1, 'nothing of the background hidden, whatever the clear alpha')
  // What the display shows of each, through a graded table at an exposure of 3: the same colour, which is not the bytes' under a grade.
  for (const settings of [
    {},
    { colorSaturationMaster: 0 },
    { whiteTemperature: 4500 },
    { sdrInverseEotf: 'bt1886' as const },
  ]) {
    const table = bakeRun(settings, TONE_MAPPING_RANK.filmic)
    const shown = (light: number[]) =>
      table.displayLight(light.map((c) => c * 3)).map((v) => v * table.bake.device[3])
    near(
      shown(direct.slice(0, 3).map((c) => c / 0.5)),
      shown(surroundings),
      `the screen and the mirror: ${JSON.stringify(settings)}`,
      1e-6,
    )
  }
  const grey = bakeRun({ colorSaturationMaster: 0 }, TONE_MAPPING_RANK.filmic)
  const [r, g, b] = grey.displayLight(surroundings.map((c) => c * 3))
  assert.ok(
    Math.abs(r - g) < 1e-5 && Math.abs(g - b) < 1e-5,
    'a graded scene’s background is graded, mirror and screen alike',
  )
})
