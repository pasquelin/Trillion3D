// A material's edit writes its one record (`follow`, `materialTable.ts`): the rows and items that
// name it hold none of its values, and are written again only where what they read beside the
// record moved — a flag, a resolve class, a fact the frame derives from its rows' surfaces.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialTable, materialWord } from './materialTable.ts'
import {
  GRAPH_HEADER,
  MATERIAL_RECORD,
  MATERIAL_RECORD_TEXELS,
  MATERIAL_RECORD_WORDS,
} from './materialLayout.ts'
import { DITHER_MODEL_BIT } from '../surface/surfaceModelWord.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { surfaceWritten } from '../../geometry/pages/surfaceWrites.ts'
import { surfaceVariant } from '../../geometry/pages/surfaceVariant.ts'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

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
    materialWord(table.surface(surfaces[row % SURFACES], layers).rank, false),
  )
  assert.equal(table.follow(layers), false, 'nothing written since')
  table.viewFor(device)
  return { device, textureWrites, table, layers, surfaces, words, sent: textureWrites.length }
}

test('a colour edit among 10⁴ rows writes one record of 160 bytes, and no row', () => {
  const { device, textureWrites, table, layers, surfaces, words, sent } = drawn()
  const edited = surfaces[37]
  edited.baseColor = [0.25, 0.5, 0.75]
  surfaceWritten(edited)
  assert.equal(table.follow(layers), false, 'its rows read nothing of it but its record')
  table.viewFor(device)
  assert.equal(textureWrites.length, sent + 1)
  const write = textureWrites.at(-1)!
  assert.deepEqual(write.size, [MATERIAL_RECORD_TEXELS, 1, 1], 'one record: 10 texels, 160 B')
  assert.deepEqual(write.destination.origin, [37 * MATERIAL_RECORD_TEXELS, 0, 0])
  const floats = new Float32Array(write.data.buffer as ArrayBuffer),
    at = 37 * MATERIAL_RECORD_WORDS + MATERIAL_RECORD.at.baseColor
  assert.deepEqual([...floats.subarray(at, at + 3)], [0.25, 0.5, 0.75])
  // Every row still names the record it named.
  for (let row = 0; row < ROWS; row++)
    assert.equal(
      materialWord(table.surface(surfaces[row % SURFACES], layers).rank, false),
      words[row],
    )
  const held = textureWrites.length
  table.viewFor(device)
  assert.equal(textureWrites.length, held, 'nothing more to send')
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
  table.viewFor(device)
  // The texture moves to another slot: no surface was written, the census says so.
  layers.mapLayer.set(map, 6)
  table.forget()
  assert.equal(table.follow(layers), false, 'a slot that moved flags nothing new')
  table.viewFor(device)
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
  table.surface(glass, layers)
  glass.opacity = 0.25
  glass.version = 1
  table.surface(glass, layers)
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
  const words = [plain, tinted, sheet].map((surface) =>
    materialWord(table.surface(surface, layers).rank, false),
  )
  assert.deepEqual(words, [0, 0, 0], 'one record, its faces and colours its rows own')
  table.follow(layers)
  table.viewFor(device)
  for (const surface of [tinted, sheet]) {
    surface.baseColor = [0.5, 0.25, 0]
    surfaceWritten(surface)
  }
  assert.equal(table.follow(layers), false)
  table.viewFor(device)
  assert.deepEqual(textureWrites.at(-1)!.size, [MATERIAL_RECORD_TEXELS, 1, 1])
  const floats = new Float32Array(textureWrites.at(-1)!.data.buffer as ArrayBuffer)
  assert.deepEqual(
    [...floats.subarray(0, 3)],
    [0.5, 0.25, 0],
    'the variants written, not the plain',
  )
})

test('a surface that wears a graph is the graph: its record holds factors that change nothing, no map and no thin transmission', () => {
  const F = MATERIAL_RECORD.at
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const map = { channel: 0 } as Texture
  const layers = { mapLayer: new Map([[map, 3]]), dataLayer: new Map<Texture, number>() }
  const own = {
    ...surfaceOf(G.basicSurface()),
    lit: true,
    baseColor: [0.2, 0.4, 0.6] as [number, number, number],
    opacity: 0.2,
    alphaTest: 0.5,
    metalness: 0.7,
    roughness: 0.3,
    emissive: [1, 2, 3] as [number, number, number],
    subsurfaceColor: [1, 0.5, 0.2] as [number, number, number],
    anisotropy: 0.8,
    clearcoat: 1,
    map,
  }
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(0.5, 0.5, 0.5))
  graph.output('anisotropy', graph.constant(0.5))
  const plain = table.surface(own, layers),
    worn = table.surface({ ...own, graph }, layers)
  table.viewFor(device)
  const words = new Uint32Array(textureWrites.at(-1)!.data.buffer as ArrayBuffer)
  const floats = new Float32Array(words.buffer)
  const at = (rank: number, field: number, n = 1) => [
    ...floats.subarray(
      rank * MATERIAL_RECORD_WORDS + field,
      rank * MATERIAL_RECORD_WORDS + field + n,
    ),
  ]
  // The material's own record keeps what it declares.
  assert.deepEqual(
    at(plain.rank, F.baseColor, 3).map((x) => +x.toFixed(2)),
    [0.2, 0.4, 0.6],
  )
  assert.deepEqual(
    at(plain.rank, F.subsurface, 3).map((x) => +x.toFixed(2)),
    [1, 0.5, 0.2],
  )
  assert.equal(words[plain.rank * MATERIAL_RECORD_WORDS + F.mapIndex], 3)
  // The graph's is neutral: the factors are one, the cutout none — the raster, which reads the
  // opacity and the cut, draws it whole —, no thin transmission, no map.
  assert.deepEqual(at(worn.rank, F.baseColor, 3), [1, 1, 1])
  assert.deepEqual(at(worn.rank, F.emissive, 3), [1, 1, 1])
  assert.deepEqual(at(worn.rank, F.subsurface, 3), [0, 0, 0])
  assert.deepEqual(
    [F.opacity, F.metalness, F.roughness, F.aoIntensity, F.normalScale].map(
      (f) => at(worn.rank, f)[0],
    ),
    [1, 1, 1, 1, 1],
  )
  assert.deepEqual([at(worn.rank, F.alphaTest)[0], at(worn.rank, F.cut)[0]], [0, 1])
  assert.equal(words[worn.rank * MATERIAL_RECORD_WORDS + F.mapIndex], 0)
  assert.equal(words[worn.rank * MATERIAL_RECORD_WORDS + F.subsurfaceMap], 0)
  // The lobe record a graph's lobes are set into carries none of the material's factors.
  const lobeAt = (rank: number) => words[rank * MATERIAL_RECORD_WORDS + F.lobes] - 1
  const lobeFactors = (rank: number) => [...floats.subarray(lobeAt(rank) * 4, lobeAt(rank) * 4 + 4)]
  assert.deepEqual(lobeFactors(plain.rank).slice(0, 3), [Math.fround(0.8), 0, 1])
  assert.deepEqual(lobeFactors(worn.rank), [0, 0, 0, 0])
})

test('a surface whose graph wires an opacityMask has its clip value as the record’s cut, whatever it is, and the dither in the record', () => {
  const F = MATERIAL_RECORD.at
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const graph = material.graph('surface')
  const wave = graph.sine(graph.time(), 2)
  graph.output('opacityMask', graph.multiply(graph.componentMask(graph.texCoord(0), 'r'), wave))
  const base = { ...surfaceOf(G.basicSurface()), lit: true, graph, version: 1 }
  const named = table.surface({ ...base, opacityMaskClipValue: 0.25 }, layers)
  const cutoff = table.surface({ ...base, alphaTest: 0.4 }, layers)
  const dithered = table.surface({ ...base, ditherOpacityMask: true }, layers)
  const unnamed = table.surface({ ...base }, layers)
  const zero = table.surface({ ...base, opacityMaskClipValue: 0 }, layers)
  const below = table.surface({ ...base, opacityMaskClipValue: -0.2 }, layers)
  // A masked surface with no graph dithers its cutout as well: the switch is the material’s.
  const plain = table.surface(
    { ...surfaceOf(G.basicSurface()), alphaTest: 0.5, ditherOpacityMask: true },
    layers,
  )
  table.viewFor(device)
  const words = new Uint32Array(textureWrites.at(-1)!.data.buffer as ArrayBuffer)
  const floats = new Float32Array(words.buffer)
  const cut = (rank: number) => floats[rank * MATERIAL_RECORD_WORDS + F.cut]
  assert.deepEqual(
    [named, cutoff, dithered, unnamed, zero, below].map((r) => cut(r.rank)),
    [0.25, 0.4, 0.3333, 0.3333, 0, -0.2].map(Math.fround),
    'the clip value named, else the alpha test, else 0.3333: zero and below are values, not none',
  )
  const header = (rank: number) => {
    const first = words[rank * MATERIAL_RECORD_WORDS + F.graph]! - 1
    return [...words.slice(first * 4, first * 4 + 4)]
  }
  assert.deepEqual(header(named.rank).slice(1), [GRAPH_HEADER.mask, 0, 0], 'a mask, and no clock')
  const dither = (rank: number) =>
    (words[rank * MATERIAL_RECORD_WORDS + F.model]! & DITHER_MODEL_BIT) !== 0
  assert.deepEqual(
    [named, dithered, plain].map((r) => dither(r.rank)),
    [false, true, true],
    'the dither is a bit of the record, any masked surface’s',
  )
  // A graph with no mask has no mask bit.
  const still = material.graph('surface')
  still.output('baseColor', still.constant(1, 0, 0))
  const calm = table.surface({ ...base, graph: still }, layers)
  table.viewFor(device)
  const again = new Uint32Array(textureWrites.at(-1)!.data.buffer as ArrayBuffer)
  const first = again[calm.rank * MATERIAL_RECORD_WORDS + F.graph]! - 1
  assert.equal(again[first * 4 + 1], 0)
})

test('a surface whose offset always evaluates has its rows written again, since they carry whether it does', () => {
  const table = createMaterialTable()
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const graph = material.graph('surface')
  graph.output('worldPositionOffset', graph.multiply(graph.time(), graph.constant(1, 0, 0)))
  // The record itself, not a copy of its fields (a spread drops its release): it is written in place.
  const surface = Object.assign(surfaceOf(G.basicSurface()), { graph, version: 1 })
  const seen = table.surface(surface, layers)
  assert.equal(table.follow(layers), false, 'first seen: its rows are written with it')
  assert.equal(table.surface(surface, layers).rank, seen.rank)
  const epoch = table.offsetEpoch
  assert.ok(epoch > 0, 'a surface that came to wear an offset moves the offset epoch')
  surface.version = 2
  Object.assign(surface, { maxWorldPositionOffset: 3 })
  surfaceWritten(surface)
  assert.equal(
    table.follow(layers),
    false,
    'a limit is in its rows’ object, not in its rows’ flags',
  )
  assert.equal(table.offsetEpoch, epoch + 1, 'but the roots read their offsets again')
  surface.version = 3
  Object.assign(surface, { alwaysEvaluateWorldPositionOffset: true })
  surfaceWritten(surface)
  assert.equal(
    table.follow(layers),
    true,
    'always: its rows say they move whatever the object says',
  )
  // A surface with no graph never moves the epoch.
  const before = table.offsetEpoch
  table.surface(surfaceOf(G.basicSurface()), layers)
  assert.equal(table.offsetEpoch, before)
})
