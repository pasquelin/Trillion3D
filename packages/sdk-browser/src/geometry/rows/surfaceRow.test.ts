// What a surface brings to its clusters is kept with its record (`SurfaceSeen.row`,
// `../../materials/table/materialTable.ts`): a cluster record write reads no atlas slot of its
// surface's maps, which only its surface's version or an atlas census moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../pages/surface.ts'
import { pageRecFixture } from '../../../../../bench/perf/browser/support/pageRecFixture.ts'
import { createInfoWriter } from '../clusters/infoWrite.ts'
import { CLUSTER_INFO } from '../dag/info/clusterInfoLayout.ts'
import { createMaterialTable } from '../../materials/table/materialTable.ts'
import { surfaceWritten } from '../pages/surfaceWrites.ts'
import { FLAG_DISPLACED, FLAG_HAS_MAP } from '../../visibility/types.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { rowFlags, surfaceRow } from './surfaceRow.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { FEATURE_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import { isProgram, programOf, type SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import {
  classIdentity,
  graphClassKey,
  releaseGraphClasses,
} from '../../materials/graph/surfaceClasses.ts'
import { takeGraphRefusals } from '../../materials/graph/kept.ts'

const RECORDS = 100

/** An atlas's slots, counting the reads. */
class CountedSlots extends Map<Texture, number> {
  reads = 0
  override get(texture: Texture) {
    this.reads++
    return super.get(texture)
  }
}

test("a cluster record write reads its surface's slots once a version and a census, not once a record", () => {
  const map = { channel: 0 } as Texture
  const mapLayer = new CountedSlots([[map, 4]]),
    dataLayer = new CountedSlots()
  const surface = surfaceOf(G.standardSurface())
  surface.map = map
  const rec = pageRecFixture({ triangles: 1, material: surface })
  const table = createMaterialTable()
  const write = createInfoWriter({
    mapLayer,
    dataLayer,
    geometryBlocks: new Map(),
    asIsShown: false,
    emissiveAoShown: false,
    materialTable: table,
  })
  let last = write(rec, 0)
  const recordsWritten = () => {
    for (let record = 0; record < RECORDS; record++) last = write(rec, 0)
    return mapLayer.reads
  }
  const at = CLUSTER_INFO.at
  const first = recordsWritten()
  assert.ok(first > 0, 'its slots read with its record')
  assert.equal(recordsWritten(), first, 'no slot read by a record of a surface that held')
  const [flags, classKey] = [last.words[at.flags], last.words[at.materialClass]]
  assert.equal(flags & FLAG_HAS_MAP, FLAG_HAS_MAP)
  for (let record = 1; record < RECORDS; record++) {
    last = write(rec, 0)
    assert.equal(last.words[at.flags], flags)
    assert.equal(last.words[at.materialClass], classKey)
  }
  // Its map released by a census: the records read the slot it holds now, once.
  mapLayer.delete(map)
  table.forget()
  const census = recordsWritten()
  assert.ok(census > first)
  assert.equal(last.words[at.flags] & FLAG_HAS_MAP, 0, 'the map flag gone')
  // A write of its own moves it again: another map, read once, then held.
  const other = { channel: 0 } as Texture
  mapLayer.set(other, 5)
  surface.map = other
  surfaceWritten(surface)
  const written = recordsWritten()
  assert.ok(written > census)
  assert.equal(last.words[at.flags] & FLAG_HAS_MAP, FLAG_HAS_MAP)
  assert.equal(recordsWritten(), written, 'then held again')
})

test('a surface displaced by a height map the atlas holds marks its rows displaced, and no other does', () => {
  const height = { channel: 0 } as Texture
  const layers = (slot?: number) => ({
    mapLayer: new Map<Texture, number>(),
    dataLayer: new Map<Texture, number>(slot ? [[height, slot]] : []),
  })
  const displaced = {
    ...surfaceOf(G.standardSurface()),
    displacementMap: height,
    displacement: { magnitude: 4, center: 0.5, fade: null },
  }
  const marked = (surface: VisMaterial, slot?: number) =>
    (surfaceRow(surface, layers(slot)).bits & FLAG_DISPLACED) !== 0
  assert.equal(marked(displaced, 3), true)
  assert.equal(marked(displaced), false, 'a height map the atlas lacks: drawn flat')
  assert.equal(marked({ ...displaced, displacement: undefined }, 3), false, 'no numbers: flat')
  assert.equal(marked({ ...displaced, displacementMap: undefined }, 3), false, 'no map: flat')
  assert.equal(marked(surfaceOf(G.standardSurface()), 3), false)
})

/** A surface wearing a graph that colours it from a parameter, and reads a texture where asked. */
function graphSurface(reads = false, map?: Texture) {
  const graph = material.graph('surface')
  const tint = graph.channel(graph.vectorParameter('tint', [1, 0.5, 0.25, 1]), 'rgb')
  const read = graph.channel(graph.textureSample(new WorldTexture()), 'rgb')
  graph.output('baseColor', reads ? graph.multiply(read, tint) : tint)
  return { ...surfaceOf(G.standardSurface()), map, graph }
}

test('a surface that wears a graph reads none of its maps, and its rows take the class of the graph', () => {
  const map = { channel: 0 } as Texture
  const layers = { mapLayer: new Map([[map, 4]]), dataLayer: new Map<Texture, number>() }
  const plain = { ...surfaceOf(G.standardSurface()), map }
  const worn = graphSurface(false, map)
  assert.equal(surfaceRow(plain, layers).map, 4, 'a surface with no graph reads its map')
  const row = surfaceRow(worn, layers)
  assert.equal(row.map, 0, 'the graph computes what the map gave')
  assert.equal(row.bits & FLAG_HAS_MAP, 0)
  assert.ok(row.graph, 'its program is kept with its row')
  const key = (surface: VisMaterial) => rowFlags(surfaceRow(surface, layers), undefined, undefined)
  assert.ok(key(worn).classKey >= FEATURE_CLASS_KEYS, 'the class is one of the graphs')
  assert.equal(key(graphSurface(false, map)).classKey, key(worn).classKey, 'one program, one class')
  assert.notEqual(key(graphSurface(true, map)).classKey, key(worn).classKey, 'another program')
  assert.ok(key(plain).classKey < FEATURE_CLASS_KEYS, 'no graph, a class of the features')
})

test('a surface whose graph does not compile is drawn from its parameters', () => {
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const graph = material.graph('surface')
  graph.output('baseColor', graph.add(graph.constant(1, 2), graph.constant(1, 2, 3)))
  const row = surfaceRow({ ...surfaceOf(G.standardSurface()), graph }, layers)
  assert.equal(row.graph, undefined, 'a width the compile refuses')
  assert.match(takeGraphRefusals()[0], /float2 and float3/)
})

/** The program of a graph that makes its emission `n`: one program for each `n`. */
function programN(n: number) {
  const graph = material.graph('surface')
  graph.output('emissive', graph.constant(n, 0, 0))
  const program = programOf({ graph })
  assert.ok(isProgram(program))
  return program
}

/** A stand-in for the program of `n`: the classes read only its text (`compiled.key`), so the keys
 *  that run out are exercised without compiling tens of thousands of programs. */
const stand = (n: number) => ({ compiled: { key: `stand ${n}` } }) as unknown as SurfaceProgram

test('the classes of the graphs no worn surface needs give their keys back; more worn at once than there are keys are named', () => {
  // Nothing is worn: every class made so far is released, and its key free after two more censuses.
  for (let census = 0; census < 3; census++) releaseGraphClasses([])
  takeGraphRefusals()
  // More graphs over time than there are keys, one worn at each census: no key runs out.
  let first: unknown
  const seen = new Set<number>()
  for (let n = 0; n < FEATURE_CLASS_KEYS + 44; n++) {
    const key = graphClassKey(n === 0 ? programN(1) : stand(n + 1), 1)
    assert.notEqual(key, undefined, `graph ${n}`)
    if (n === 0) first = classIdentity(key!)
    seen.add(key!)
    releaseGraphClasses([key!])
  }
  assert.ok(seen.size < FEATURE_CLASS_KEYS, 'the keys were taken again')
  assert.deepEqual(takeGraphRefusals(), [])
  // A key taken again stands for another class: its pipelines are not the old one's.
  const taken = [...seen][0]!
  assert.notEqual(classIdentity(taken), first)
  // All of them worn at once: the keys run out at the one past them, named once.
  for (let census = 0; census < 3; census++) releaseGraphClasses([])
  const live = Array.from({ length: FEATURE_CLASS_KEYS + 1 }, (_, n) =>
    graphClassKey(stand(1000 + n), 2),
  )
  assert.equal(live.filter((key) => key === undefined).length, 1)
  assert.equal(live.at(-1), undefined)
  assert.match(
    takeGraphRefusals()[0]!,
    new RegExp(`at most ${FEATURE_CLASS_KEYS} classes of graph programs at once`),
  )
  assert.equal(graphClassKey(stand(1000 + FEATURE_CLASS_KEYS), 2), undefined)
  assert.deepEqual(takeGraphRefusals(), [], 'named once')
  for (const key of live) if (key !== undefined) assert.ok(key >= FEATURE_CLASS_KEYS)
})
