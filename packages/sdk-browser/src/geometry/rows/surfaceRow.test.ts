// What a surface brings to its rows is kept with its record (`SurfaceSeen.row`,
// `../../materials/table/materialTable.ts`): a row write reads no atlas slot of its surface's maps, which
// only its surface's version or an atlas census moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../pages/surface.ts'
import { pageRecFixture } from '../../../../../bench/perf/browser/support/pageRecFixture.ts'
import { createPageRowWriter } from './page/pageRowWriter.ts'
import { createMaterialTable } from '../../materials/table/materialTable.ts'
import { surfaceWritten } from '../pages/surfaceWrites.ts'
import { FLAG_DISPLACED, FLAG_HAS_MAP, ROW_WORDS } from '../../visibility/types.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { surfaceRow } from './surfaceRow.ts'

const ROWS = 100

/** An atlas's slots, counting the reads. */
class CountedSlots extends Map<Texture, number> {
  reads = 0
  override get(texture: Texture) {
    this.reads++
    return super.get(texture)
  }
}

test("a row write reads its surface's slots once a version and a census, not once a row", () => {
  const map = { channel: 0 } as Texture
  const mapLayer = new CountedSlots([[map, 4]]),
    dataLayer = new CountedSlots()
  const surface = surfaceOf(G.standardSurface())
  surface.map = map
  const rec = pageRecFixture({ triangles: 1, material: surface })
  const table = createMaterialTable()
  const write = createPageRowWriter(
    {
      mapLayer,
      dataLayer,
      geometryBlocks: new Map(),
      asIsShown: false,
      emissiveAoShown: false,
      materialTable: table,
    },
    () => {},
    () => 0,
  )
  const floats = new Float32Array(ROW_WORDS * ROWS),
    ints = new Uint32Array(floats.buffer)
  const rowsWritten = () => {
    for (let row = 0; row < ROWS; row++) write(rec, 0, row, 0, floats, ints)
    return mapLayer.reads
  }
  const first = rowsWritten()
  assert.ok(first > 0, 'its slots read with its record')
  assert.equal(rowsWritten(), first, 'no slot read by a row of a surface that held')
  const flags = ints[PAGE_INFO.at.flags]
  assert.equal(flags & FLAG_HAS_MAP, FLAG_HAS_MAP)
  for (let row = 1; row < ROWS; row++) {
    assert.equal(ints[row * ROW_WORDS + PAGE_INFO.at.flags], flags)
    assert.equal(
      ints[row * ROW_WORDS + PAGE_INFO.at.materialClass],
      ints[PAGE_INFO.at.materialClass],
    )
  }
  // Its map released by a census: the rows read the slot it holds now, once.
  mapLayer.delete(map)
  table.forget()
  const census = rowsWritten()
  assert.ok(census > first)
  assert.equal(ints[PAGE_INFO.at.flags] & FLAG_HAS_MAP, 0, 'the map flag gone')
  // A write of its own moves it again: another map, read once, then held.
  const other = { channel: 0 } as Texture
  mapLayer.set(other, 5)
  surface.map = other
  surfaceWritten(surface)
  const written = rowsWritten()
  assert.ok(written > census)
  assert.equal(ints[(ROWS - 1) * ROW_WORDS + PAGE_INFO.at.flags] & FLAG_HAS_MAP, FLAG_HAS_MAP)
  assert.equal(rowsWritten(), written, 'then held again')
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
  const marked = (surface: typeof displaced, slot?: number) =>
    (surfaceRow(surface, layers(slot)).bits & FLAG_DISPLACED) !== 0
  assert.equal(marked(displaced, 3), true)
  assert.equal(marked(displaced), false, 'a height map the atlas lacks: drawn flat')
  assert.equal(marked({ ...displaced, displacement: undefined }, 3), false, 'no numbers: flat')
  assert.equal(marked({ ...displaced, displacementMap: undefined }, 3), false, 'no map: flat')
  assert.equal(marked(surfaceOf(G.standardSurface()) as typeof displaced, 3), false)
})
