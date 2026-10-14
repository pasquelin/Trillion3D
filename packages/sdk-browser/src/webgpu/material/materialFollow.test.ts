// A material's edit writes its one record (`follow`, `materialTable.ts`): the rows and items that
// name it hold none of its values, and are written again only where what they read beside the
// record moved — a flag, a resolve class, a fact the frame derives from its rows' surfaces.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialTable } from './materialTable.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_TEXELS, MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { surfaceOf } from '../../page/surface.ts'
import { surfaceWritten } from '../../page/surfaceWrites.ts'
import { surfaceVariant } from '../../page/surfaceVariant.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const ROWS = 10_000,
  SURFACES = 100

/** A variant: vertex colours, both faces. */
const variant = (vertexColors: boolean, twoSided: boolean) => ({
  vertexColors,
  flatShading: false,
  twoSided,
})

/** A table whose 10⁴ rows name 100 standard surfaces, sent up once: the frame they were drawn in. */
function drawn() {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const surfaces = Array.from({ length: SURFACES }, () => surfaceOf(G.basicSurface()))
  const words = Array.from({ length: ROWS }, (_, row) =>
    table.word(surfaces[row % SURFACES], layers),
  )
  assert.equal(table.follow(layers), false, 'nothing written since')
  table.upload(device)
  return { device, textureWrites, table, layers, surfaces, words, sent: textureWrites.length }
}

test('a colour edit among 10⁴ rows writes one record of 160 bytes, and no row', () => {
  const { device, textureWrites, table, layers, surfaces, words, sent } = drawn()
  const edited = surfaces[37]
  edited.baseColor = [0.25, 0.5, 0.75]
  surfaceWritten(edited)
  assert.equal(table.follow(layers), false, 'its rows read nothing of it but its record')
  table.upload(device)
  assert.equal(textureWrites.length, sent + 1)
  const write = textureWrites.at(-1)!
  assert.deepEqual(write.size, [MATERIAL_RECORD_TEXELS, 1], 'one record: 10 texels, 160 B')
  assert.deepEqual(write.destination.origin, [37 * MATERIAL_RECORD_TEXELS, 0])
  const floats = new Float32Array(write.data.buffer as ArrayBuffer),
    at = 37 * MATERIAL_RECORD_WORDS + MATERIAL_RECORD.at.baseColor
  assert.deepEqual([...floats.subarray(at, at + 3)], [0.25, 0.5, 0.75])
  // Every row still names the record it named.
  for (let row = 0; row < ROWS; row++)
    assert.equal(table.word(surfaces[row % SURFACES], layers), words[row])
  assert.equal(table.pending, false, 'nothing more to send')
})

test('an alpha test or a map that appears moves the rows: they are written again', () => {
  const { table, layers, surfaces } = drawn()
  surfaces[3].alphaTest = 0.5
  surfaceWritten(surfaces[3])
  assert.equal(table.follow(layers), true, 'the cutout flag')
  const map = { channel: 0 } as Texture
  layers.mapLayer.set(map, 4)
  surfaces[5].map = map
  surfaceWritten(surfaces[5])
  assert.equal(table.follow(layers), true, 'the base map flag and class')
  surfaces[5].roughness = 0.25
  surfaceWritten(surfaces[5])
  assert.equal(table.follow(layers), false, 'a factor alone')
})

test('an atlas census rewrites every record a slot moved in, and moves the rows it flags', () => {
  const { device, textureWrites, table, layers, surfaces } = drawn()
  const map = { channel: 0 } as Texture
  layers.mapLayer.set(map, 2)
  surfaces[8].map = map
  surfaceWritten(surfaces[8])
  table.follow(layers)
  table.upload(device)
  // The texture moves to another slot: no surface was written, the census says so.
  layers.mapLayer.set(map, 6)
  table.forget()
  assert.equal(table.follow(layers), false, 'a slot that moved flags nothing new')
  table.upload(device)
  const floats = new Uint32Array(textureWrites.at(-1)!.data.buffer as ArrayBuffer)
  assert.equal(floats[8 * MATERIAL_RECORD_WORDS + MATERIAL_RECORD.at.mapIndex], 6)
  // Released: slot 0, no map any more — the rows' base map flag goes.
  layers.mapLayer.delete(map)
  table.forget()
  assert.equal(table.follow(layers), true)
})

test('a blended surface rewritten moves its items and casters: they read its values themselves', () => {
  const { table, layers } = drawn()
  const glass = { ...surfaceOf(G.basicSurface()), transparent: true, opacity: 0.5, version: 0 }
  table.word(glass, layers)
  glass.opacity = 0.25
  glass.version = 1
  table.word(glass, layers)
  assert.equal(table.follow(layers), true)
})

test("a material's variants name its one record: an edit written to each writes it once", () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const plain = surfaceOf(G.basicSurface()),
    variants = new Map()
  const tinted = surfaceVariant(plain, variants, variant(true, false)),
    sheet = surfaceVariant(plain, variants, variant(false, true))
  const words = [plain, tinted, sheet].map((surface) => table.word(surface, layers))
  assert.deepEqual(words, [0, 0, 0], 'one record, its faces and colours its rows own')
  table.follow(layers)
  table.upload(device)
  for (const surface of [tinted, sheet]) {
    surface.baseColor = [0.5, 0.25, 0]
    surfaceWritten(surface)
  }
  assert.equal(table.follow(layers), false)
  table.upload(device)
  assert.deepEqual(textureWrites.at(-1)!.size, [MATERIAL_RECORD_TEXELS, 1])
  const floats = new Float32Array(textureWrites.at(-1)!.data.buffer as ArrayBuffer)
  assert.deepEqual(
    [...floats.subarray(0, 3)],
    [0.5, 0.25, 0],
    'the variants written, not the plain',
  )
})
