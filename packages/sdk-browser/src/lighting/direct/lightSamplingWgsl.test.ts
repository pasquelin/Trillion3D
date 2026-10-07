import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { directLightSamplingWgsl, SAMPLED_RANKS } from './lightSamplingWgsl.ts'
import { directLightingWgsl, declaredLightingWgsl } from './lightingWgsl.ts'
import { hashUnit } from '../../../../math/src/wgsl/sampling.ts'
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts'
import {
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
} from '../../gpu/core/shaderTexts.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

const DIRECT_LIGHTING_WGSL = wgslModule(directLightingWgsl())

/** The sampled resolve of a program that shades rectangles, the default one. */
const sampling = directLightSamplingWgsl().text
const K = wgslConstants(DIRECT_LIGHTING_WGSL)
const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

test('deferred resolve samples a shadowed list on a ranked image and walks every light otherwise', () => {
  // Rank zero is the plain loop, unchanged; a moving cell whose list holds no
  // shadowed light, or a list the draw refuses, takes the same one call site of the sum.
  assert.match(
    DIRECT_LIGHTING_WGSL,
    /let rank=u32\(view\.viewport\.w\);\s*if\(rank==0u\|\|!shadowed\|\|slice\.x==TILE_NO_SLICE\|\|!sampledList\(slice\.y\)\)\{return sliceLighting\(rgb,metal,rough,N,V,P,ao,slice\);\}\s*return sampledSliceLighting\(/,
  )
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.equal(occurrences(shader, sampling), 1)
    assert.equal(occurrences(shader, hashUnit.text), 1, 'one hash, defined once')
  }
  // The blend pass shades its lights in full: a forward surface has no history to average.
  assert.equal(
    occurrences(
      wgslModule(declaredLightingWgsl({ proxy: 11, transmittance: 26 })),
      'sampledSliceLighting',
    ),
    0,
  )
})

test('a moving resolve reads the cell flag, never the list, to choose the sum', () => {
  const run = (shadowed: boolean, kept = 8, first = 0) => {
    const { contractLighting } = shaderFunctions<{
      contractLighting: (...args: unknown[]) => number
    }>(DIRECT_LIGHTING_WGSL, ['contractLighting', 'sampledList'], {
      ...K,
      view: { viewport: { w: 7 } },
      vec3f: () => 0,
      cellSlice: () => ({ x: first, y: kept }),
      sliceLighting: () => 1,
      sampledSliceLighting: () => 2,
    })
    return contractLighting(0, 0, 0, 0, 0, 0, 0, { x: 20.5, y: 0.5 }, 2, shadowed)
  }
  assert.equal(run(false), 1, 'no shadowed light: the exact full sum the still image shows')
  assert.equal(run(true), 2, 'a shadowed light: the drawn resolve')
  // A list the drawn resolve would sum in full takes the still image's call:
  // within the sample budget, past the longest list drawn, or with no room in the pool.
  assert.equal(run(true, LIGHT_SETTINGS.samplesPerPixel), 1, 'within the budget: the full sum')
  assert.equal(run(true, LIGHT_SETTINGS.tileLights + 1), 1, 'past the list: the full sum')
  assert.equal(run(true, 8, K.TILE_NO_SLICE), 1, 'no room in the pool: the full sum')
})

test('the sample budget is the published setting', () => {
  assert.match(sampling, new RegExp(`const LIGHT_SAMPLES:u32=${LIGHT_SETTINGS.samplesPerPixel}u;`))
  // A light worth a sample's share is shaded exactly, once; the drawn ones are divided by their
  // probability, copies counted (`sampledWeights.test.ts` runs the draw).
  assert.match(sampling, /let exact=weight\*f32\(LIGHT_SAMPLES\)>=total;/)
  assert.match(
    sampling,
    /if\(chosen\[slot\]<TILE_LIGHTS\)\{factor=total\/\(f32\(LIGHT_SAMPLES\)\*lightWeight\(light,N,P\)\);\}/,
  )
  // The offset depends on the pixel and the bounded rank only: a replayed image is the same image.
  assert.match(
    sampling,
    /fract\(hashUnit\(u32\(pixel\.y\)\*65536u\+u32\(pixel\.x\)\)\+f32\(rank\)\*GOLDEN_FRACTION\)/,
  )
  assert.ok(SAMPLED_RANKS * 0.61803399 < 2 ** 10, 'the rank keeps the fraction its precision')
})

test("one loop shades the lights of a pixel in full: its cell's list or the scene", () => {
  // The sampled weights are recomputed where read: no private array of TILE_LIGHTS weights.
  assert.doesNotMatch(sampling, /array<f32,/)
  assert.equal(
    occurrences(sampling, 'lightWeight('),
    3,
    'defined once, read by the list and by the factor of a drawn light',
  )
  // One call to the shading in the full loop (`sliceLighting`), one in the sampled one: no walk
  // over the scene beside them, the no-list fallback of the blend pass included.
  assert.equal(occurrences(DIRECT_LIGHTING_WGSL, 'declaredLight(directLights.items['), 1)
  assert.equal(
    occurrences(
      wgslModule(declaredLightingWgsl({ proxy: 11, transmittance: 26 })),
      'declaredLight(',
    ),
    2,
  )
})

test('a cell reads its list in the pool, or every light where the pool had no room', () => {
  const { cellSlice } = shaderFunctions<{ cellSlice: (base: number) => { x: number; y: number } }>(
    DIRECT_LIGHTING_WGSL,
    ['cellSlice'],
    {
      ...K,
      tileLights: new Uint32Array([K.TILE_SHADOWED | 5, 40, 3, K.TILE_NO_SLICE]),
      directLights: { count: 300 },
    },
  )
  // The count's shadow bit is no light: five lights from word 40.
  assert.deepEqual(cellSlice(0), { x: 40, y: 5 })
  assert.deepEqual(cellSlice(K.TILE_STRIDE), { x: K.TILE_NO_SLICE, y: 300 })
})
