// What a surface brings to its rows is kept with its record (`SurfaceSeen.row`,
// `../material/materialTable.ts`): a row write reads no atlas slot of its surface's maps, which
// only its surface's version or an atlas census moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../page/surface.ts'
import { pageRecFixture } from '../../../../../bench/perf/browser/support/pageRecFixture.ts'
import { createPageRowWriter } from './pageRowWriter.ts'
import { createMaterialTable } from '../material/materialTable.ts'
import { surfaceWritten } from '../../page/surfaceWrites.ts'
import { FLAG_HAS_MAP, ROW_WORDS } from '../../visibility/types.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'

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
    [{ world: new Matrix4() }],
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
