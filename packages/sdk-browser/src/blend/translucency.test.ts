import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { blend, close, type Rgba } from './blendModel.fixture.ts'
import { translucencyBytes } from './translucency.ts'
import { COMPOSE_DUAL_WGSL, COMPOSE_WGSL, layersOver } from './translucencyComposeWgsl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'

/** The scale and add draws' states, as `composePipelines` makes them. */
const OVER = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } as const
const SCALE: GPUBlendState = {
  color: { srcFactor: 'zero', dstFactor: 'src' },
  alpha: { srcFactor: 'zero', dstFactor: 'src-alpha' },
}
// The second draw writes the colour channels alone: its alpha keeps what the first left.
const ADD: GPUBlendState = { color: OVER, alpha: { srcFactor: 'zero', dstFactor: 'one' } }

/** The composition's two draws on one scene pixel: each fragment's output for the texels the layers
 *  and the modulation left, then its blend state over what the image holds. */
function composed(scene: Rgba, layers: Rgba, modulation: Rgba) {
  const output = (name: 'scale' | 'add') =>
    shaderRun<Record<typeof name, (pixel: number[]) => { first: Rgba }>>(COMPOSE_WGSL, [name], {
      layers,
      modulation,
      textureLoad: (texture: Rgba) => texture,
      textureDimensions: () => [8, 8],
    })[name]([0, 0, 0, 0]).first
  return blend(ADD, output('add'), blend(SCALE, output('scale'), scene))
}

/** The dual-source draw's pixel on one scene pixel: the first source added, the scene times the second. */
function composedDual(scene: Rgba, layers: Rgba, modulation: Rgba) {
  const out = shaderRun<Record<'composeDual', (pixel: number[]) => { light: Rgba; factor: Rgba }>>(
    COMPOSE_DUAL_WGSL,
    ['composeDual'],
    {
      layers,
      modulation,
      textureLoad: (texture: Rgba) => texture,
      textureDimensions: () => [8, 8],
    },
  ).composeDual([0, 0, 0, 0])
  return scene.map((value, k) => out.light[k] + value * out.factor[k]) as unknown as Rgba
}

test('the composition shows the scene times the modulation times the transmittance, plus the light', () => {
  const scene: Rgba = [0.5, 0.4, 0.3, 1]
  const out = composed(scene, [0.1, 0.2, 0.05, 0.25], [0.5, 1, 0.8, 0])
  close(
    out.slice(0, 3),
    [0.5 * 0.5 * 0.25 + 0.1, 0.4 * 0.25 + 0.2, 0.3 * 0.8 * 0.25 + 0.05],
    'colour',
  )
  close(
    [out[3]],
    [0.25 * ((0.5 + 1 + 0.8) / 3)],
    'the alpha, times the transmittance and the visible background',
  )
})

test('the one dual-source draw composes the image as the two draws do', () => {
  const cases: [Rgba, Rgba, Rgba][] = [
    [
      [0.5, 0.4, 0.3, 1],
      [0.1, 0.2, 0.05, 0.25],
      [0.5, 1, 0.8, 0],
    ],
    [
      [0.5, 0.4, 0.3, 0.6],
      [0.1, 0.2, 0.05, 0.25],
      [0.5, 1, 0.8, 1],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0.75],
      [1, 1, 1, 0],
    ],
    [
      [0.2, 0.3, 0.1, 0.5],
      [1, 1, 1, 1],
      [0.5, 0.5, 0.5, 0.25],
    ],
  ]
  for (const [scene, layers, modulation] of cases)
    close(
      composedDual(scene, layers, modulation),
      composed(scene, layers, modulation),
      'same image',
    )
})

test('where the modulation’s alpha is 1 the composition leaves the image’s alpha as it is', () => {
  const scene: Rgba = [0.5, 0.4, 0.3, 0.6]
  const layers: Rgba = [0.1, 0.2, 0.05, 0.25]
  const kept = composed(scene, layers, [0.5, 1, 0.8, 1])
  close([kept[3]], [0.6], 'the alpha, kept')
  close(
    kept.slice(0, 3),
    composed(scene, layers, [0.5, 1, 0.8, 0]).slice(0, 3),
    'the colour, the same',
  )
})

test('the alpha of the image is the scene’s, times the transmittance and the visible background, never a coverage the layers add', () => {
  const bare: Rgba = [0, 0, 0, 0]
  // Over a pixel the scene leaves bare, layers and light add colour and no alpha.
  for (const [layers, modulation] of [
    [
      [0, 0, 0, 0.75],
      [1, 1, 1, 0],
    ],
    [
      [1, 1, 1, 1],
      [1, 1, 1, 0],
    ],
    [
      [0, 0, 0, 1],
      [0.5, 0.5, 0.5, 0.25],
    ],
  ] as const)
    assert.equal(composed(bare, [...layers], [...modulation])[3], 0)
  // A pane that lets 0.75 through, over a covered pixel: three quarters of it.
  close([composed([0, 0, 0, 1], [0, 0, 0, 0.75], [1, 1, 1, 0])[3]], [0.75], 'a pane')
  // A glow that hides nothing leaves it.
  close([composed([0, 0, 0, 1], [1, 1, 1, 1], [1, 1, 1, 0])[3]], [1], 'a glow')
})

test('the targets cost two texels a pixel of the format where the scene has translucent layers', () => {
  const texel = texelBytesOf(HDR_FORMAT)
  assert.equal(translucencyBytes(true, false, 8, 4, [16, 8]), 2 * 8 * 4 * texel)
  assert.equal(translucencyBytes(false, false, 8, 4, [16, 8]), 0)
  // A second set and the image the late layers are composed into, at the larger of the sizes.
  assert.equal(translucencyBytes(true, true, 8, 4, [16, 8]), (4 * 8 * 4 + 16 * 8) * texel)
})

test('the depth of field composes the layers as the two draws do', () => {
  const run = shaderRun<{
    layersOver: (scene: Rgba, layers: Rgba, modulation: Rgba) => Rgba
  }>(wgslProgram('', [layersOver]), ['layersOver'], {})
  const cases: [Rgba, Rgba, Rgba][] = [
    [
      [0.5, 0.4, 0.3, 1],
      [0.1, 0.2, 0.05, 0.25],
      [0.5, 1, 0.8, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0.75],
      [1, 1, 1, 0],
    ],
    [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [1, 1, 1, 0],
    ],
    [
      [0.2, 0.3, 0.1, 0.5],
      [0.1, 0.1, 0.1, 1],
      [0.5, 0.5, 0.5, 0.25],
    ],
    [
      [0.2, 0.3, 0.1, 0.5],
      [0, 0, 0, 1],
      [1, 1, 1, 0],
    ],
  ]
  for (const [scene, layers, modulation] of cases)
    close(
      run.layersOver(scene, layers, modulation),
      composed(scene, layers, modulation),
      'same image',
    )
})
