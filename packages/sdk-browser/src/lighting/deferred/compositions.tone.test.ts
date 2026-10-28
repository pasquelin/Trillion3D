/**
 * The compositions' layouts and the tone table they read: the bindings of each input, and the table baked once, again when a setting
 * or the curve changes, remade at another size.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompositions } from './compositions.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './shaders.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { askToneBake, createToneLut } from '../toneLut.ts'
import { pipelinesSettled } from './compileLedger.ts'
import { BAKE_LAYOUT } from '../toneBakeWgsl.ts'
import {
  COLOR_GRADING_RULES,
  type ColorGradingValues,
} from '../../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'

test('a composition binds the flags and base colour of the as-is pixels, a lit one the tone table after them', async () => {
  installGpuGlobals()
  const { device, bindGroupLayouts } = fakeDevice()
  const bindings = (sources: typeof CONTRACT_COMPOSITIONS | typeof UNLIT_COMPOSITIONS) =>
    createCompositions(device, sources, 'LAYOUT').then((made) =>
      Object.fromEntries(
        Object.entries(made.layouts).map(([input, layout]) => [
          input,
          [...(layout as unknown as GPUBindGroupLayoutDescriptor).entries].map((e) => e.binding),
        ]),
      ),
    )
  // The as-is input binds the surfaces' flags and base colour (2, 3), the unlit chain too since its
  // as-is pixels are drawn after the temporal pass as the lit chain's (it bound one share and the
  // unlit chain none).
  assert.deepEqual(await bindings(CONTRACT_COMPOSITIONS), {
    asIs: [0, 1, 2, 3, 4, 5, 6],
    flagless: [0, 1, 2, 3, 4],
  })
  assert.deepEqual(await bindings(UNLIT_COMPOSITIONS), {
    asIs: [0, 1, 2, 3],
    flagless: [0, 1],
  })
  assert.ok(bindGroupLayouts.length > 0)
  // The text reads the table where the layout binds it: after the as-is pixels', or in their place.
  assert.match(CONTRACT_COMPOSITIONS.plain.asIs, /@binding\(4\) var toneTable:texture_3d<f32>/)
  assert.match(CONTRACT_COMPOSITIONS.plain.flagless, /@binding\(2\) var toneTable:texture_3d<f32>/)
})

test('the tone table is baked once for settings that hold, again when a setting or the curve changes, remade at another size', async () => {
  installGpuGlobals()
  const { device, textures, dispatches } = fakeDevice()
  const lut = createToneLut(device)
  // The baking's program, compiled off the frame before a frame bakes.
  askToneBake(device)
  await pipelinesSettled(device)
  const values = (settings: object) =>
    resolveSettings(COLOR_GRADING_RULES, settings) as ColorGradingValues
  const rank = TONE_MAPPING_RANK.filmic
  const encoder = device.createCommandEncoder()
  assert.equal(lut.moving(values({}), rank), true, 'nothing baked yet')
  assert.equal(lut.baked, false)
  const first = lut.view()
  assert.equal(textures.filter(({ label }) => label?.endsWith('tone table')).length, 1)
  assert.equal(lut.moving(values({}), rank), true, 'a table made is not a table baked')
  assert.equal(lut.encode(encoder, values({}), rank), true)
  assert.equal(lut.baked, true)
  assert.equal(lut.bytes, 32 ** 3 * 8, 'the view’s reserve counts the cube: 8 bytes a texel')
  assert.equal(lut.words?.length, BAKE_LAYOUT.words, 'the baking’s words, which the layers copy')
  assert.equal(lut.view(), first, 'the texture made at the first ask is the one baked')
  assert.equal(lut.encode(encoder, values({}), rank), false, 'settings and curve as they were')
  const side = () => textures.filter(({ label }) => label?.endsWith('tone table')).at(-1)!.width
  assert.equal(side(), 32, 'rgba16float, 32 texels a side')
  assert.equal(lut.moving(values({ whiteTint: 0.2 }), rank), true, 'a setting')
  assert.equal(lut.moving(values({}), TONE_MAPPING_RANK.none), true, 'the scene’s curve')
  assert.equal(lut.encode(encoder, values({ lutSize: 16 }), rank), true)
  assert.notEqual(lut.view(), first, 'another size, another texture')
  assert.equal(side(), 16)
  assert.equal(lut.bytes, 16 ** 3 * 8)
  // No other limit than the device's: a cube of 64 on a device that makes 3D textures of 24 is baked at 24.
  const small = fakeDevice({ limits: { maxTextureDimension3D: 24 } })
  const capped = createToneLut(small.device)
  askToneBake(small.device)
  await pipelinesSettled(small.device)
  capped.encode(small.device.createCommandEncoder(), values({ lutSize: 64 }), rank)
  assert.equal(capped.bytes, 24 ** 3 * 8)
  assert.equal(
    capped.words?.[BAKE_LAYOUT.at.lattice + 1],
    24,
    'the baking reads the side it was made at',
  )
  const bakes = dispatches.filter(({ entryPoint }) => entryPoint === 'bakeTable')
  assert.deepEqual(
    bakes.map(({ direct, rows }) => [direct, rows]),
    [
      [8, 8],
      [4, 4],
    ],
    'one pass over the cube, a workgroup of 4 texels a side',
  )
})
