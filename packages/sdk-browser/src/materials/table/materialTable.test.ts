import test from 'node:test'
import assert from 'node:assert/strict'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { createMaterialTable, materialWord } from './materialTable.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_TEXELS, MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { DISPLACEMENT_RECORD, DISPLACEMENT_WORDS } from './displacementRecord.ts'
import {
  fadeOutPixels,
  displacementRange,
  pagesDisplacementReach,
} from '../../visibility/tessellation/numbers.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TESS_READ_PLAIN_WGSL } from '../../visibility/tessellation/queueWgsl.ts'
import { MATERIAL_RANK_MASK } from '../../visibility/types.ts'

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
    [0, 2 * MATERIAL_RECORD_TEXELS + 1, 2 * MATERIAL_RECORD_TEXELS + 4],
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
  assert.equal(words[F.model], 3 | 8, 'the model, the fog opt-out above it')
  assert.equal(floats[F.invIor], Math.fround(1 / 1.5))
  // k = log2(c) / d, a black channel's past any path but zero.
  assert.deepEqual([floats[F.attenuation], floats[F.attenuation + 1]], [0, -0.5])
  assert.ok(floats[F.attenuation + 2] < -1e18)
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

test('a displaced surface has its record written at its rank beside the table, and cleared with it', () => {
  const table = createMaterialTable()
  const height = { channel: 2 } as Texture
  const l = { mapLayer: new Map<Texture, number>(), dataLayer: new Map([[height, 6]]) }
  const D = DISPLACEMENT_RECORD.at
  assert.equal(table.displaced.count, 0, 'a scene without one holds none')
  assert.equal(table.displaced.ints.length, 0, 'and allocates none')
  table.surface(lit(), l)
  const surface = {
    ...lit(),
    version: 0,
    displacementMap: height,
    displacement: { magnitude: 4, center: 0.5, fade: { start: 4, end: 1 } },
  }
  const { rank } = table.surface(surface, l)
  const words = table.displaced.ints,
    floats = new Float32Array(words.buffer),
    at = rank * DISPLACEMENT_WORDS
  assert.equal(rank, 1)
  assert.deepEqual([...floats.slice(at + D.scale, at + D.scale + 4)], [4, 0.5, 4, 1])
  assert.deepEqual([words[at + D.map], words[at + D.map + 1]], [6, 2], 'the slot, the texture set')
  assert.deepEqual(
    [...floats.slice(at + D.density, at + D.density + 4)],
    [0, 0, 0, 0],
    'unmeasured',
  )
  assert.equal(table.displaced.count, 1)
  // The densities the compiler measured, 0 for a set it did not: a change of them alone is one.
  const measured = table.displaced.version
  surface.displacement = { ...surface.displacement, uvDensities: [2, 0.5, 0, 8] } as never
  surface.version = 1
  table.surface(surface, l)
  assert.deepEqual([...floats.slice(at + D.density, at + D.density + 4)], [2, 0.5, 0, 8])
  assert.ok(table.displaced.version > measured)
  // A fade that never fades writes zero for both ends; the count holds, the version moves.
  const version = table.displaced.version
  surface.displacement = { magnitude: 2, center: 0, fade: null }
  surface.version = 2
  table.surface(surface, l)
  assert.deepEqual([...floats.slice(at, at + 4)], [2, 0, 0, 0])
  assert.deepEqual([table.displaced.count, table.displaced.version > version], [1, true])
  // A surface that stops being displaced, or whose height map the atlas lost, is drawn flat.
  surface.version = 3
  l.dataLayer.delete(height)
  table.surface(surface, l)
  assert.deepEqual(
    [...words.slice(at, at + DISPLACEMENT_WORDS)],
    new Array(DISPLACEMENT_WORDS).fill(0),
  )
  assert.equal(table.displaced.count, 0)
})

test('the tessellation reads a row’s record from the region of its buffer the records fill, by rank', () => {
  // Three records written as the table sends them, at word 100 of the buffer, each its rank's.
  const tess = new Uint32Array(100 + 3 * DISPLACEMENT_WORDS),
    floats = new Float32Array(tess.buffer)
  for (let rank = 0; rank < 3; rank++) {
    const at = 100 + rank * DISPLACEMENT_WORDS,
      D = DISPLACEMENT_RECORD.at
    floats.set([rank + 1, 0.5, 4, 1], at + D.scale)
    floats.set([-1, rank + 2, 0, 0], at + D.bounds)
    tess.set([20 + rank, 1, 0, 0], at + D.map)
    floats.set([rank + 3, 0, 0.25, 0], at + D.density)
  }
  const { displacementOf } = shaderRun<{
    displacementOf(page: { material: number }): Record<string, number[]>
  }>(wgslBlock('records', [TESS_READ_PLAIN_WGSL], ''), ['tw', 'tw4', 'displacementOf'], {
    tess,
    tu: { dispBase: 100 },
    MATERIAL_RANK_MASK,
  })
  const row = displacementOf({ material: 1 | (1 << 31) })
  const words = (name: 'scale' | 'bounds' | 'map' | 'density') => row[name]
  assert.deepEqual(words('scale'), [2, 0.5, 4, 1])
  assert.deepEqual(words('bounds'), [-1, 3, 0, 0])
  assert.deepEqual(words('map'), [21, 1, 0, 0])
  assert.deepEqual(words('density'), [4, 0, 0.25, 0])
})

test('the distances a displacement moves a point by hold zero, ordered whichever way the magnitude points', () => {
  // The heights 0 and 1 against the centre that stays on the surface, times the magnitude.
  assert.deepEqual(displacementRange({ magnitude: 2, center: 0.25 }), { min: -0.5, max: 1.5 })
  assert.deepEqual(displacementRange({ magnitude: -2, center: 0.25 }), { min: -1.5, max: 0.5 })
  // A centre of zero never goes in; of one, never out; the range still holds zero.
  assert.deepEqual(displacementRange({ magnitude: 3, center: 0 }), { min: 0, max: 3 })
  assert.deepEqual(displacementRange({ magnitude: 3, center: 1 }), { min: -3, max: 0 })
  // Faded out at the smaller of the two ends, never for a displacement that does not fade.
  assert.equal(fadeOutPixels({ fade: { start: 4, end: 2 } }), 2)
  assert.equal(fadeOutPixels({ fade: null }), 0)
  // What a primitive's boxes grow by: the greatest reach of the displaced surfaces of its pages.
  const height = {} as Texture
  const page = (displacement: { magnitude: number; center: number; fade: null } | undefined) => ({
    material: { displacement, displacementMap: displacement && { texture: height, channel: 0 } },
  })
  assert.equal(pagesDisplacementReach([]), 0)
  assert.equal(pagesDisplacementReach([page(undefined), page(undefined)]), 0)
  assert.equal(
    pagesDisplacementReach([
      page({ magnitude: 2, center: 0.25, fade: null }),
      page(undefined),
      page({ magnitude: 4, center: 0.5, fade: null }),
    ]),
    2,
  )
})
