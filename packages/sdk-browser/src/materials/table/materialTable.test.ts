import test from 'node:test'
import assert from 'node:assert/strict'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { createMaterialTable, materialWord } from './materialTable.ts'
import { F, layers, lit, sentWords } from './materialTable.fixture.ts'
import { MATERIAL_RECORD_TEXELS, MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { LOBE_RECORD_TEXELS } from './lobeRecord.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { PIXEL_MODEL } from '../surface/pixelModel.ts'
import {
  SURFACE_MODEL_MASK,
  SUBSURFACE_OPACITY_MODEL_SHIFT,
  TRANSLUCENCY_LIGHTING_MODEL_SHIFT,
  TRANSLUCENT_SHADOW_MARK,
  TRANSLUCENT_SHADOW_MODEL_SHIFT,
} from '../surface/surfaceModelWord.ts'
import { LIGHTLESS_MODEL, TRANSLUCENCY_LIGHTING_CODE } from '../surface/translucencyLighting.ts'

/** The collector, called on demand: what the open world's churn waits for. */
function gcOf() {
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as (() => void) | undefined
}

test('every surface takes a rank; a lobed one names its lobe extension, two to a place', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  assert.equal(materialWord(table.surface(lit(), l).rank, false), 0)
  const coated = { ...lit(), clearcoat: 1 },
    brushed = { ...lit(), anisotropy: 0.5 }
  // The coat's record is rank 1, its extensions' place rank 2: the next record is rank 3.
  assert.equal(materialWord(table.surface(coated, l).rank, false), 1)
  assert.equal(materialWord(table.surface(brushed, l).rank, false), 3)
  assert.equal(materialWord(table.surface(coated, l).rank, false), 1, 'a surface keeps its record')
  table.viewFor(device)
  const words = sentWords(textureWrites)
  const lobes = (rank: number) => words[rank * MATERIAL_RECORD_WORDS + F.lobes]
  assert.deepEqual(
    [lobes(0), lobes(1), lobes(3)],
    [0, 2 * MATERIAL_RECORD_TEXELS + 1, 2 * MATERIAL_RECORD_TEXELS + 1 + LOBE_RECORD_TEXELS],
  )
  // The coat's extension: its clamped factors and its coat normal's scales.
  const floats = new Float32Array(words.buffer)
  const coat = 2 * MATERIAL_RECORD_WORDS
  assert.deepEqual([...floats.slice(coat, coat + 6)], [0, 0, 1, Math.fround(ROUGHNESS_FLOOR), 1, 1])
})

test('a record holds the factors, the cut, both normal factors, the slots and the volume', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const map = { channel: 0 } as Texture,
    normalMap = { channel: 0 } as Texture
  const l = { mapLayer: new Map([[map, 4]]), dataLayer: new Map([[normalMap, 7]]) }
  const surface = {
    ...lit(),
    ...{ baseColor: [0.5, 0.25, 1] as [number, number, number], opacity: 2, alphaTest: 0 },
    ...{ dashSize: 0, gapSize: 3, normalScaleY: -1, tangentNormalScaleY: 1, map, normalMap },
    ...{ ior: 1.5, refracts: true, attenuationColor: [1, 0.5, 0] as [number, number, number] },
    ...{ attenuationDistance: 2, transmission: 1, fog: false, model: 3 },
  }
  table.surface(surface, l)
  table.viewFor(device)
  const words = sentWords(textureWrites),
    floats = new Float32Array(words.buffer)
  assert.deepEqual([...floats.slice(0, 4)], [0.5, 0.25, 1, 2], 'the opacity as declared')
  // A dashed line declared without an alpha test cuts its gaps alone: threshold zero.
  assert.deepEqual([floats[F.cut], floats[F.dash], floats[F.dash + 1]], [0, 0, 3])
  assert.deepEqual([floats[F.normalScaleY], floats[F.tangentNormalScaleY]], [-1, 1])
  assert.deepEqual([words[F.mapIndex], words[F.normalIndex], words[F.aoIndex]], [4, 7, 0])
  assert.equal(
    words[F.model],
    3 |
      8 |
      (TRANSLUCENCY_LIGHTING_CODE.volumetricNonDirectional << TRANSLUCENCY_LIGHTING_MODEL_SHIFT) |
      (255 << SUBSURFACE_OPACITY_MODEL_SHIFT),
    'the model, the fog opt-out above it, the lighting of a material made in code, the subsurface opacity (one unsaid)',
  )
  assert.equal(floats[F.invIor], Math.fround(1 / 1.5))
  // k = log2(c) / d, a black channel's past any path but zero.
  assert.deepEqual([floats[F.attenuation], floats[F.attenuation + 1]], [0, -0.5])
  assert.ok(floats[F.attenuation + 2] < -1e18)
})

test('a record holds how its surface reads the shadows of the lights, a mark each, a quality above 0 asking the trace', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const marks = (asked: object) => {
    const { rank } = table.surface({ ...lit(), ...asked }, l)
    table.viewFor(device)
    const word = sentWords(textureWrites)[rank * MATERIAL_RECORD_WORDS + F.model]
    return (word >>> TRANSLUCENT_SHADOW_MODEL_SHIFT) & 7
  }
  const { local, localTrace, directionalTrace } = TRANSLUCENT_SHADOW_MARK
  assert.equal(marks({}), 0, 'a surface that asks nothing')
  assert.equal(marks({ translucentLocalLightShadow: true }), local)
  assert.equal(marks({ translucentLocalLightShadowQuality: 0.01 }), localTrace)
  assert.equal(marks({ translucentLocalLightShadowQuality: 0 }), 0)
  assert.equal(marks({ translucentDirectionalLightShadowQuality: 1 }), directionalTrace)
  assert.equal(
    marks({
      ...{ translucentLocalLightShadow: true, translucentLocalLightShadowQuality: 1 },
      translucentDirectionalLightShadowQuality: 1,
    }),
    local | localTrace | directionalTrace,
  )
})

test('a record holds the lightless rank in its model lane for a standard surface of a shading model the volume does not light, in a volume mode', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const lane = (asked: object) => {
    const { rank } = table.surface({ ...lit(), ...asked }, l)
    table.viewFor(device)
    return sentWords(textureWrites)[rank * MATERIAL_RECORD_WORDS + F.model] & SURFACE_MODEL_MASK
  }
  const hair = PIXEL_MODEL.hair
  assert.equal(lane({ shadingModel: hair }), LIGHTLESS_MODEL, 'hair in the default volume mode')
  assert.equal(lane({ shadingModel: hair, translucencyLighting: 'volume' }), LIGHTLESS_MODEL)
  assert.equal(
    lane({ shadingModel: hair, translucencyLighting: 'forward' }),
    0,
    'forward lights it',
  )
  assert.equal(
    lane({ shadingModel: PIXEL_MODEL.subsurface }),
    0,
    'the thin subsurface is lit by the volume',
  )
  assert.equal(lane({}), 0, 'the default lit model')
  assert.equal(lane({ shadingModel: hair, model: 2 }), 2, 'a toon surface keeps its model')
})

test('a surface whose version and atlas held is not written again; a new one is', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const surface = { ...lit(), version: 3 }
  table.surface(surface, l)
  table.viewFor(device)
  // A field written without its version moving is not read: the version says what is current.
  surface.roughness = 0.5
  // Nothing to send: a call sends nothing.
  const sent = () => {
    const before = textureWrites.length
    table.viewFor(device)
    return textureWrites.length - before
  }
  table.surface(surface, l)
  assert.equal(sent(), 0)
  surface.version = 4
  table.surface(surface, l)
  assert.equal(sent(), 1)
  assert.equal(new Float32Array(textureWrites.at(-1)!.data.buffer)[F.roughness], 0.5)
  // A slot that moved under the same count is read again once the atlas says so (`forget`).
  const map = { channel: 0 } as Texture
  surface.map = map
  surface.version = 5
  l.mapLayer.set(map, 5)
  table.surface(surface, l)
  table.viewFor(device)
  l.mapLayer.set(map, 2)
  table.surface(surface, l)
  assert.equal(sent(), 0)
  table.forget()
  table.surface(surface, l)
  table.viewFor(device)
  assert.equal(sentWords(textureWrites)[F.mapIndex], 2)
})

test('an upload sends the records written since, neighbours in one write, not the whole table', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const surfaces = Array.from({ length: 5 }, (_, i) => ({ ...lit(), version: i }))
  for (const surface of surfaces) table.surface(surface, l)
  table.viewFor(device)
  for (const [i, version] of [
    [2, 10],
    [3, 11],
  ]) {
    surfaces[i].roughness = 0.5
    surfaces[i].version = version
    table.surface(surfaces[i], l)
  }
  table.viewFor(device)
  const sent = textureWrites.at(-1)!
  assert.deepEqual(
    [sent.destination.origin, sent.size],
    [
      [2 * MATERIAL_RECORD_TEXELS, 0, 0],
      [2 * MATERIAL_RECORD_TEXELS, 1, 1],
    ],
  )
})

test('a surface that loses its lobe gives its extension to the next lobed one', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const coated = { ...lit(), clearcoat: 1, version: 0 }
  table.surface(coated, l)
  coated.clearcoat = 0
  coated.version = 1
  table.surface(coated, l)
  const brushed = { ...lit(), anisotropy: 1 }
  assert.equal(materialWord(table.surface(brushed, l).rank, false), 2)
  table.viewFor(device)
  const words = sentWords(textureWrites)
  assert.equal(words[F.lobes], 0)
  assert.equal(words[2 * MATERIAL_RECORD_WORDS + F.lobes], MATERIAL_RECORD_TEXELS + 1)
})

test('the rank of a surface the collector took goes to the next surface', async (t) => {
  const collect = gcOf()
  if (!collect) return t.skip('no collector to call')
  const table = createMaterialTable()
  const l = layers()
  assert.equal(materialWord(table.surface(lit(), l).rank, false), 0)
  // Every later surface stays held to the end: the first is the only one the collector may take,
  // so each round's rank is the next one or the first's.
  const held = [lit()]
  assert.equal(materialWord(table.surface(held[0], l).rank, false), 1)
  let taken = false
  for (let round = 0; round < 10 && !taken; round++) {
    collect()
    await new Promise((settled) => setTimeout(settled, 0))
    held.push(lit())
    const word = materialWord(table.surface(held.at(-1)!, l).rank, false)
    taken = word === 0
    if (!taken) assert.equal(word, 2 + round)
  }
  assert.ok(taken, 'the first surface was never collected')
  assert.equal(materialWord(table.surface(held[0], l).rank, false), 1)
})
