// Debug views are output untouched: a normal or depth material is never exposed nor tone
// mapped, so on WebGPU a normal or depth surface carries one flag through the resolve and the
// lighting pass, and the composition draws it after the temporal pass and the chain from the
// surfaces — its flag and its base colour at the render texel under the display pixel — as the
// reference's buffer visualisation does.
// Every expression is read out of the shipped shader text and run by the shared WGSL run, so a
// shader edit is what the tests see. (The composition weighed a share — the flags', or one the
// temporal pass accumulated beside the colour —, which is gone.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { AS_IS_FLAG, SURFACE_MODEL } from '../materials/surface/surfaceModelWord.ts'
import { shownAsIs } from '../materials/surface/surfaceModel.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './deferred/shaders.ts'
import { BLEND_MODES } from '../materials/surface/materialBlending.ts'
import { written } from '../blend/blendModel.fixture.ts'
import {
  BLEND_SHADER,
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  TAA_SHADER,
} from '../gpu/core/shaderTexts.fixture.ts'
import { RESPONSIVE_TARGET } from '../blend/responsive.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'

/** The capture of `pattern` in `source`, asserted present. */
function capture(source: string, pattern: RegExp) {
  const found = source.match(pattern)
  assert.ok(found, `no line matching ${pattern}`)
  return found.slice(1)
}
/** Shipped WGSL `lines` run by the shared WGSL run (`shaderRun`), as the body of a function of
 *  `params` returning `result`; `scope` binds what the lines read beside. */
const runLines = <T extends (...args: never[]) => unknown>(
  lines: string,
  params: string,
  result: string,
  scope: object,
) =>
  shaderRun<{ lines: T }>(`fn lines(${params})->f32{${lines}return ${result};}`, ['lines'], scope)
    .lines
/** A stand-in display curve that bends every value, as ACES does. */
const curve = (rgb: number) => rgb / (1 + rgb)
const EXPOSURE = 0.7

/** The as-is compositions: the lit chain's plain and finishing ones, the unlit chain's. */
const AS_IS_COMPOSITIONS = [
  CONTRACT_COMPOSITIONS.plain.asIs,
  CONTRACT_COMPOSITIONS.finish!.asIs,
  UNLIT_COMPOSITIONS.plain.asIs,
]
/** `composeColor` of `shader` at the display pixel `pixel`, the surfaces drawn at `surface` render
 *  pixels per display pixel, their texel holding `flag` and the grey base colour `base`; the chain
 *  (`composeChain`) a stand-in that exposes and curves the image's grey `lit`. Returns the colour
 *  and the texels the surfaces were read at. */
function composeOf(
  shader: string,
  { pixel = [7.5, 1.5], surface = 1, flag = AS_IS_FLAG, base = 0.25, lit = 2, raw = 0 } = {},
) {
  const read: number[][] = []
  const { composeColor } = shaderRun<{ composeColor: (pixel: number[]) => number[] }>(
    shader,
    ['composeColor'],
    {
      asIsFlags: 'flags',
      asIsBase: 'base',
      textureLoad: (texture: string, texel: number[]) => (
        read.push([...texel]),
        texture === 'flags' ? [flag, 0, 0, 0] : [base, base, base, 1]
      ),
      view: {
        viewport: [8, 4, raw, 0],
        surface: [surface, surface, 8 * surface - 1, 4 * surface - 1],
      },
      composeChain: () => [curve(lit * EXPOSURE), 0, 0, 1],
      linearToSrgb: (rgb: number[]) => rgb.map((c) => c * 2),
    },
  )
  return { color: composeColor([...pixel, 0, 1]), read }
}

test('A normal or depth surface resolves to the as-is flag, passed through unlit', () => {
  const flagOf = runLines<(model: number, page: { flags: number }) => number>(
    '',
    'model:u32,page:Page',
    capture(SHADE_SHADER, /vec4f\(0\.0,0\.0,0\.0,1\.0\),(select\(.*?\)),request\);\}/)[0],
    {},
  )
  // A shadow catcher is always blended: the opaque shade never draws it.
  const opaque = Object.values(SURFACE_MODEL).filter((model) => model !== SURFACE_MODEL.shadow)
  for (const model of opaque.filter((model) => model >= 3))
    for (const flags of [0, 1 << 20])
      assert.equal(flagOf(model, { flags }) === AS_IS_FLAG, shownAsIs(model), `model ${model}`)
  assert.ok(shownAsIs(SURFACE_MODEL.normal) && shownAsIs(SURFACE_MODEL.depth))
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER])
    assert.match(
      shader,
      new RegExp(`if\\(flag==${AS_IS_FLAG}u\\)\\{return vec4f\\(base\\.rgb,0\\.0\\);\\}`),
    )
})

// A debug view's pixel is drawn over the chain's output, after the temporal pass, from the
// surfaces at the view's place, unfiltered — the reference's visualisation reads its scene textures
// at the view's UV with a point sampler after the tonemapper; a lit surface keeps the chain's
// exposure and curve, bit for bit.
test('A debug view reaches sRGB untouched from the surfaces, a lit surface keeps exposure and curve', () => {
  for (const shader of AS_IS_COMPOSITIONS) {
    for (const base of [1, 0.5, 0.25])
      assert.deepEqual(composeOf(shader, { base }).color, [2 * base, 2 * base, 2 * base, 1])
    for (const flag of [0, 1, 2, 4, 5])
      assert.deepEqual(composeOf(shader, { flag }).color, [curve(2 * EXPOSURE), 0, 0, 1])
    // A raw view's output is the chain's.
    assert.deepEqual(composeOf(shader, { raw: 1 }).color, [curve(2 * EXPOSURE), 0, 0, 1])
    // At the display's size the surfaces' texel is the pixel's; drawn at half of it, the render
    // texel under it, the last one past the edge.
    assert.deepEqual(composeOf(shader).read, [
      [7, 1],
      [7, 1],
    ])
    assert.deepEqual(composeOf(shader, { surface: 0.5 }).read, [
      [3, 0],
      [3, 0],
    ])
    assert.deepEqual(
      composeOf(shader, { flag: 2 }).read,
      [[7, 1]],
      'a lit pixel reads its flag alone',
    )
  }
  // The flagless compositions read none.
  for (const shader of [CONTRACT_COMPOSITIONS.plain.flagless, UNLIT_COMPOSITIONS.plain.flagless])
    assert.doesNotMatch(shader, /asIs/)
})

// The temporal pass accumulates no as-is pixel: no update reads a flag, nor keeps a share beside
// the colour (it accumulated the share by the colour's weights so that a jittered edge did not flip).
test('The temporal pass reads no flag and keeps no as-is share', () => {
  assert.doesNotMatch(TAA_SHADER, /flags|asIs|shareOut|keptShare/)
})

// A transparent over a debug surface is not shown there: the reference's visualisation reads the
// scene textures, which no translucency writes, and draws them over the scene colour that holds
// it — so the base colour is drawn over the blended image.
test('a lit transparent over a debug surface leaves it as it is', () => {
  // The blend writes no share: its outputs are its colour, the request, the display layers and the
  // responsiveness.
  assert.doesNotMatch(BLEND_SHADER, /asIs/)
  // Whatever the blended image holds under the as-is pixel, its base colour is drawn.
  for (const shader of AS_IS_COMPOSITIONS)
    for (const lit of [0, 0.4, 2])
      assert.deepEqual(composeOf(shader, { lit }).color, [0.5, 0.5, 0.5, 1])
  for (const mode of BLEND_MODES) {
    // The responsiveness the layers carry into the temporal analysis: the largest of their own
    // marks, so a layer of none (0) lowers none, in any order.
    const responsive = RESPONSIVE_TARGET
    assert.equal(responsive.format, 'r8unorm', mode)
    assert.equal(written(responsive, [1 / 3, 0, 0, 1], [0.5, 0, 0, 0])[0], 0.5, mode)
    assert.equal(written(responsive, [1, 0, 0, 1], [0.5, 0, 0, 0])[0], 1, mode)
  }
})
