// On WebGPU a layer is drawn into the translucency target — what it adds and the transmittance
// in its alpha — or, if it multiplies the scene, into the modulation target, and the image shows
// the scene times the modulation times the transmittance, plus what the layers add
// (`translucency.ts`): over an opaque surface the layer shows what the reference display shows,
// the background never through it. This follows one pixel through the transparent pass's own blend
// state (`blendTargets`) and the composition's weighting. Multiply and subtractive colours are the
// reference display's, in display space, after the tone curve (`display/displayFilter.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { blend, close, display, shown, srgb, written, type Rgba } from './blendModel.fixture.ts'
import { FILMIC, displayFilterRun, displayRoute, toneOf } from './display/displayRun.fixture.ts'
import { CONTRACT_COMPOSITIONS } from '../lighting/deferred/shaders.ts'
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts'
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'
import { blendTargets } from './blendTargets.ts'
import { modulatesScene } from '../materials/surface/materialBlending.ts'
import { bakeRun } from '../lighting/toneBake.fixture.ts'

/** What the pass writes for `src` over `dst` in `mode`: its target's own blend state. */
const blended = (mode: Blending, src: Rgba, dst: Rgba) =>
  blend(blendTargets(mode, 0xf, true)[0]!.blend!, src, dst)

/** The targets before any layer: the translucency target holds no light and lets all through, the
 *  modulation target multiplies by 1 (`TRANSLUCENCY_CLEAR`, `MODULATION_CLEAR`). */
const CLEARED = { translucency: [0, 0, 0, 1], modulation: [1, 1, 1, 0] } as const

/** What the image shows of `surface` under the layers of `mode` drawn in turn, each `src`: the scene
 *  times the modulation times the transmittance, plus the light (`composeTranslucency`). */
function composed(mode: Blending, layers: readonly Rgba[], surface: Rgba) {
  const modulating = modulatesScene(mode)
  let target: Rgba = modulating ? CLEARED.modulation : CLEARED.translucency
  for (const layer of layers) target = blended(mode, layer, target)
  const [modulation, light, transmittance] = modulating
    ? [target, [0, 0, 0], 1]
    : [[1, 1, 1], target, target[3]]
  return [0, 1, 2].map((c) => surface[c] * modulation[c] * transmittance + light[c])
}

/** What the reference display shows on its opaque canvas: the mode's colour equation over `dst`. */
const WITNESS: Record<'normal' | 'subtractive' | 'multiply', (s: Rgba, d: Rgba) => number[]> = {
  normal: (s, d) => [0, 1, 2].map((c) => s[c] * s[3] + d[c] * (1 - s[3])),
  subtractive: (s, d) => [0, 1, 2].map((c) => d[c] * (1 - s[c])),
  multiply: (s, d) => [0, 1, 2].map((c) => d[c] * s[c]),
}

test('over an opaque surface the three modes show what the witness shows', () => {
  const ink: Rgba = [1, 0.023, 0.023, 0.8]
  for (const surface of [
    [0.0015, 0.0018, 0.003, 1],
    [0.89, 0.85, 0.78, 1],
  ] as Rgba[])
    for (const mode of ['normal', 'subtractive', 'multiply'] as const)
      close(composed(mode, [ink], surface), WITNESS[mode](ink, surface), mode)
})

test('three multiplied discs over the night half stay black', () => {
  close(
    composed('multiply', Array(3).fill([0.9, 0.9, 0.9, 0.8]), [0.0015, 0.0018, 0.003, 1]),
    [0.0015, 0.0018, 0.003].map((v) => v * 0.729),
    'multiply',
  )
})

test('the layers of the translucency target leave the transmittance each by its own equation', () => {
  const layer: Rgba = [0.5, 0.4, 0.3, 0.6]
  const left = (mode: Blending, layers: number) =>
    Array.from({ length: layers }).reduce<Rgba>(
      (target) => blended(mode, layer, target),
      CLEARED.translucency,
    )[3]
  assert.ok(Math.abs(left('normal', 2) - 0.16) < 1e-9, 'two layers of 0.6 leave 0.4 · 0.4')
  assert.ok(Math.abs(left('alphaComposite', 2) - 0.16) < 1e-9, 'as a normal one')
  assert.equal(left('additive', 3), 1, 'light takes none of the scene away')
  // A holdout cuts away what the layers behind it added, and the scene behind it as well.
  const behind = blended('normal', layer, CLEARED.translucency)
  const held = blended('alphaHoldout', layer, behind)
  close(held, [behind[0] * 0.4, behind[1] * 0.4, behind[2] * 0.4, behind[3] * 0.4], 'holdout')
})

test('the display layers take the colour the composition shows, through its curve', () => {
  // The shipped route: exposure, the curve unless unlit, then sRGB, as the composition's chain;
  // its sRGB exponent, 0.41666, is 1/2.4 within 1e-4 over [0, 4]. A colour the curve leaves under
  // white: the film curve's table reaches 1.05 where the display value stops at 1, and the target
  // clips the difference.
  const colour = [1.2, 0.02, 0.3]
  for (const [exposure, unlit] of [
    [1, false],
    [0.5, false],
    [2, true],
  ] as const) {
    const owed = unlit ? srgb(colour) : display(colour.map((v) => v * exposure))
    const { keep, tint, add } = displayRoute[2](colour, exposure, FILMIC, unlit, 0.8, 1)
    assert.equal(keep, 1)
    close(tint, [...owed, 1], `tint ${exposure}`, 1e-4)
    close(add, [...owed, 1], `add ${exposure}`, 1e-4)
  }
  // The composition reads the baked table where the layers run the chain on its words (the fragment
  // stage of a blend has no sampled texture to spare, `gpu/core/stageLimits.test.ts`): the table's
  // texels, at the defaults, are the layers' colour, for the curve the layers run with, each over
  // the table's scale.
  assert.match(
    CONTRACT_COMPOSITIONS.plain.flagless,
    /toneShown\(value\.rgb\*view\.preExposure\.y,u32\(view\.display\.x\)\)/,
  )
  const baked = bakeRun({}, FILMIC)
  for (const code of [0.3, 0.45, 0.6, 0.65]) {
    const light = baked.shaperLight([code, code * 0.8, code * 0.5], 0)
    const texel = baked
      .tableColor([code, code * 0.8, code * 0.5])
      .map((v) => v * baked.bake.device[3])
    const layer = display(light)
    close(texel, layer, `texel ${code}`, 1e-5)
  }
})

test('a graded scene’s display layers are graded: the multiply layer shows the table’s colour, not the default curve’s', () => {
  const colour = [0.9, 0.3, 0.1]
  const filmic = FILMIC
  const settings = [
    { colorSaturationMaster: 0 },
    { whiteTemperature: 4500 },
    { sdrInverseEotf: 'bt1886' },
    { tonemapperGamma: 3 },
  ] as const
  const plain = displayRoute[2](colour, 1, filmic, false, 1, 1, toneOf({}, filmic)).tint
  for (const options of settings) {
    const table = bakeRun(options, filmic)
    const owed = table.displayLight(colour).map((v) => v * table.bake.device[3])
    const { tint, add } = displayRoute[2](colour, 1, filmic, false, 1, 1, toneOf(options, filmic))
    close(tint, [...owed, 1], `tint ${JSON.stringify(options)}`, 1e-6)
    close(add, [...owed, 1], `add ${JSON.stringify(options)}`, 1e-6)
    assert.ok(
      tint.slice(0, 3).some((v, c) => Math.abs(v - plain[c]) > 0.01),
      `${JSON.stringify(options)} moves the layer`,
    )
  }
  // A monochrome scene shows monochrome glass: the layers carry the grade the scene has.
  const [red, green, blue] = displayRoute[2](
    colour,
    1,
    filmic,
    false,
    1,
    1,
    toneOf(settings[0], filmic),
  ).tint
  assert.ok(Math.abs(red - green) < 1e-5 && Math.abs(green - blue) < 1e-5)
  // Unlit, the layer is shown as it is: the grade is the lit image's.
  const unlit = displayRoute[2](colour, 1, filmic, true, 1, 1, toneOf(settings[0], filmic)).tint
  close(unlit, [...srgb(colour), 1], 'unlit', 1e-6)
})

test('a layer routes by its pipeline: nothing, where masked, or always', () => {
  const colour = [0.5, 0.25, 0.1],
    owed = display(colour)
  const none = displayRoute[0](colour, 1, FILMIC, false, 0.6, 1)
  assert.deepEqual(none, { keep: 1, tint: [1, 1, 1, 1], add: [0, 0, 0, 0] })
  for (const masked of [0, 1]) {
    const { keep, tint, add } = displayRoute[1](colour, 1, FILMIC, false, 0.6, masked)
    const a = 0.6 * masked
    assert.equal(keep, 1 - masked)
    close(tint, [0, 0, 0, a], `tint ${masked}`)
    close(add, [...owed.map((v) => v * a), a], `add ${masked}`, 1e-5)
  }
})

test('subtractive and multiply over paper show the witness in display space', () => {
  // A red ink disc over paper, both lit, in linear light: the curve mixes the channels, so the linear
  // equation left R = 132 where the reference display shows 0 on the measured scene.
  const paper: Rgba = [0.89, 0.85, 0.78, 1]
  const ink: Rgba = [1.2, 0.02, 0.02, 0.8]
  for (const mode of ['subtractive', 'multiply'] as const) {
    const targets = blendTargets(mode, 0xf, true, true)
    // The lit target keeps the paper; both layers take the ink's display colour (route 2).
    close([...written(targets[0]!, ink, paper)], [...paper], `${mode} lit target`)
    const route = displayRoute[2](ink.slice(0, 3), 1, FILMIC, false, ink[3], 1)
    // The display layers follow the request since the as-is share's slot is gone.
    const tint = blend(targets[2]!.blend!, route.tint, [1, 1, 1, 1])
    const add = blend(targets[3]!.blend!, route.add, [0, 0, 0, 0])
    // The display filter pass: the composed paper times the tint, plus the added value.
    const filter = displayFilterRun(
      [1, 1],
      () => [...tint],
      () => [...add],
    )
    const at = filter.screen(0)
    const tinted = blend(TINT_EQUATIONS.multiply, filter.tint(at).canvas, shown(paper))
    const onScreen = blend(ADD_EQUATIONS.additive, filter.add(at).canvas, tinted)
    const owed = WITNESS[mode](shown(ink), shown(paper))
    close(onScreen.slice(0, 3), owed, `${mode} display`, 1e-5)
  }
})

test('the layers drawn below the display are sampled to it, not read at its pixel', () => {
  // The full-screen triangle's place: (0, 0) at the top left, (1, 1) at the bottom right of the
  // share the image covers, sampled there, level 0, on both outputs.
  const drawn: [number, number] = [0.5, 0.75],
    layer = (uv: number[]) => [uv[0], uv[1], 0.25, 0.5]
  const filter = displayFilterRun(drawn, layer, (uv) => layer(uv).map((v) => 1 - v))
  const corners = [0, 1, 2].map(filter.screen)
  assert.deepEqual(
    corners.map(({ position }) => position),
    [
      [-1, -1, 0, 1],
      [3, -1, 0, 1],
      [-1, 3, 0, 1],
    ],
  )
  // The place the rasteriser interpolates at clip `(x, y)`, from the triangle's three corners.
  const placeAt = (x: number, y: number) => {
    const weights = [1 - (x + 1) / 4 - (y + 1) / 4, (x + 1) / 4, (y + 1) / 4]
    return [0, 1].map((i) => corners.reduce((sum, { uv }, k) => sum + uv[i] * weights[k], 0))
  }
  close(placeAt(-1, 1), [0, 0], 'top left')
  close(placeAt(1, -1), drawn, 'bottom right')
  const at = { position: [0, 0, 0, 1], uv: [0.2, 0.3] }
  for (const [name, owed] of [
    ['tint', [0.2, 0.3, 0.25, 1]],
    ['add', [0.8, 0.7, 0.75, 1]],
  ] as const) {
    const { capture, canvas } = filter[name](at)
    close(capture, owed, `${name} capture`)
    close(canvas, owed, `${name} canvas`)
  }
})
