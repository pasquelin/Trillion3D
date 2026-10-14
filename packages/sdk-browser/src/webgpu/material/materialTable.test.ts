import test from 'node:test'
import assert from 'node:assert/strict'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { createMaterialTable } from './materialTable.ts'
import {
  MATERIAL_RECORD,
  MATERIAL_RECORD_TEXELS,
  MATERIAL_RECORD_WORDS,
  MATERIAL_ROW_RECORDS,
  MATERIAL_ROW_TEXELS,
} from './materialLayout.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

/** The collector, called on demand: what the open world's churn waits for. */
function gcOf() {
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as (() => void) | undefined
}

const F = MATERIAL_RECORD.at
const lit = () => ({ ...surfaceOf([]), lit: true })
const layers = () => ({
  mapLayer: new Map<Texture, number>(),
  dataLayer: new Map<Texture, number>(),
})
/** The words the last upload sent, whole: record `r` from word `r · MATERIAL_RECORD_WORDS`. */
const sentWords = (writes: { data: ArrayBufferView }[]) =>
  new Uint32Array(writes.at(-1)!.data.buffer as ArrayBuffer)

test('every surface takes a rank; a lobed one names its lobe extension, three to a place', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  assert.equal(table.word(lit(), l), 0)
  const coated = { ...lit(), clearcoat: 1 },
    brushed = { ...lit(), anisotropy: 0.5 }
  // The coat's record is rank 1, its extensions' place rank 2: the next record is rank 3.
  assert.equal(table.word(coated, l), 1)
  assert.equal(table.word(brushed, l), 3)
  assert.equal(table.word(coated, l), 1, 'a surface keeps its record')
  table.upload(device)
  const words = sentWords(textureWrites)
  const lobes = (rank: number) => words[rank * MATERIAL_RECORD_WORDS + F.lobes]
  assert.deepEqual([lobes(0), lobes(1), lobes(3)], [0, 2 * MATERIAL_RECORD_TEXELS + 1, 2 * 10 + 4])
  // The coat's extension: its clamped factors and its coat normal's scales.
  const floats = new Float32Array(words.buffer)
  assert.deepEqual([...floats.slice(80, 86)], [0, 0, 1, Math.fround(ROUGHNESS_FLOOR), 1, 1])
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
    ...{ ior: 1.5, attenuationColor: [1, 0.5, 0] as [number, number, number] },
    ...{ attenuationDistance: 2, transmission: 1, fog: false, model: 3 },
  }
  table.word(surface, l)
  table.upload(device)
  const words = sentWords(textureWrites),
    floats = new Float32Array(words.buffer)
  assert.deepEqual([...floats.slice(0, 4)], [0.5, 0.25, 1, 2], 'the opacity as declared')
  // A dashed line declared without an alpha test cuts its gaps alone: threshold zero.
  assert.deepEqual([floats[F.cut], floats[F.dash], floats[F.dash + 1]], [0, 0, 3])
  assert.deepEqual([floats[F.normalScaleY], floats[F.tangentNormalScaleY]], [-1, 1])
  assert.deepEqual([words[F.mapIndex], words[F.normalIndex], words[F.aoIndex]], [4, 7, 0])
  assert.equal(words[F.model], 3 | 8, 'the model, the fog opt-out above it')
  assert.deepEqual([floats[F.invIor], floats[F.f0]], [Math.fround(1 / 1.5), Math.fround(0.04)])
  // k = log2(c) / d, a black channel's past any path but zero.
  assert.deepEqual([floats[F.attenuation], floats[F.attenuation + 1]], [0, -0.5])
  assert.ok(floats[F.attenuation + 2] < -1e18)
})

test('the table grows by doubling its rows, the old texture retired once the frame is submitted', () => {
  const { device, textureWrites, textures, destroyed, fences } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  table.word(lit(), l)
  const first = table.upload(device),
    old = textures.at(-1)!
  assert.equal(old.height, 1)
  for (let i = 1; i < MATERIAL_ROW_RECORDS * 2 + 1; i++) table.word(lit(), l)
  assert.notEqual(table.upload(device), first)
  // Three rows hold the records, every one sent up again; the texture doubles to four.
  assert.deepEqual([textures.at(-1)!.height, textures.at(-1)!.width], [4, MATERIAL_ROW_TEXELS])
  assert.deepEqual(textureWrites.at(-1)!.size, [MATERIAL_ROW_TEXELS, 3])
  // A pass of this image encoded earlier still binds the old view: its submit comes after.
  assert.equal(destroyed.includes(old), false, 'not destroyed while the image is encoded')
  assert.equal(fences(), 0, 'no promise per texture: the frame-end retire list holds it')
  destroyRetired(device)
  assert.equal(destroyed.includes(old), true, 'destroyed once the frame is submitted')
  table.dispose()
})

test('a surface whose version and atlas held is not written again; a new one is', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const surface = { ...lit(), version: 3 }
  table.word(surface, l)
  table.upload(device)
  // A field written without its version moving is not read: the version says what is current.
  surface.roughness = 0.5
  table.word(surface, l)
  assert.equal(table.pending, false)
  surface.version = 4
  table.word(surface, l)
  assert.equal(table.pending, true)
  table.upload(device)
  assert.equal(new Float32Array(textureWrites.at(-1)!.data.buffer)[F.roughness], 0.5)
  // A slot that moved under the same count is read again once the atlas says so (`forget`).
  const map = { channel: 0 } as Texture
  surface.map = map
  surface.version = 5
  l.mapLayer.set(map, 5)
  table.word(surface, l)
  table.upload(device)
  l.mapLayer.set(map, 2)
  table.word(surface, l)
  assert.equal(table.pending, false)
  table.forget()
  table.word(surface, l)
  table.upload(device)
  assert.equal(sentWords(textureWrites)[F.mapIndex], 2)
})

test('an upload sends the span of the records written since, not the whole table', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const surfaces = Array.from({ length: 5 }, (_, i) => ({ ...lit(), version: i }))
  for (const surface of surfaces) table.word(surface, l)
  table.upload(device)
  for (const [i, version] of [
    [2, 10],
    [3, 11],
  ]) {
    surfaces[i].roughness = 0.5
    surfaces[i].version = version
    table.word(surfaces[i], l)
  }
  table.upload(device)
  const sent = textureWrites.at(-1)!
  assert.deepEqual(
    [sent.destination.origin, sent.size],
    [
      [2 * MATERIAL_RECORD_TEXELS, 0],
      [2 * MATERIAL_RECORD_TEXELS, 1],
    ],
  )
})

test('a surface that loses its lobe gives its extension to the next lobed one', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const coated = { ...lit(), clearcoat: 1, version: 0 }
  table.word(coated, l)
  coated.clearcoat = 0
  coated.version = 1
  table.word(coated, l)
  const brushed = { ...lit(), anisotropy: 1 }
  assert.equal(table.word(brushed, l), 2)
  table.upload(device)
  const words = sentWords(textureWrites)
  assert.equal(words[F.lobes], 0)
  assert.equal(words[2 * MATERIAL_RECORD_WORDS + F.lobes], MATERIAL_RECORD_TEXELS + 1)
})

test('the rank of a surface the collector took goes to the next surface', async (t) => {
  const collect = gcOf()
  if (!collect) return t.skip('no collector to call')
  const table = createMaterialTable()
  const l = layers()
  assert.equal(table.word(lit(), l), 0)
  const kept = lit()
  assert.equal(table.word(kept, l), 1)
  for (let round = 0; round < 10; round++) {
    collect()
    await new Promise((settled) => setTimeout(settled, 0))
    const word = table.word(lit(), l)
    if (word === 0) return
    assert.equal(word, 2 + round)
  }
  assert.fail('the first surface was never collected')
})
