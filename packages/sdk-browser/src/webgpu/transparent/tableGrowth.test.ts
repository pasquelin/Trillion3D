import test from 'node:test'
import assert from 'node:assert/strict'
import type * as G from '../../host/graph/graph.fixture.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { ClusterRoot } from '../../page/selection/types.ts'
import type { BlendGpuItem } from '../blend/state.ts'
import { createTransparentTable, TRANSPARENT_GROUP } from './table.ts'

const mesh = (name: string) => ({ name }) as unknown as G.HostMesh
// A placement is named by the world its root and its item read: here, one per mesh.
const rec = (node: G.HostMesh, id: number, sourceOrder: number) =>
  ({
    id,
    sourceOrder,
    transparent: true,
    drawSource: { node },
    triangles: 1,
  }) as unknown as PageRec
const root = (pages: PageRec[]) =>
  ({ pages, world: pages[0]?.drawSource?.node }) as unknown as ClusterRoot<PageRec>
const item = (node: G.HostMesh) =>
  ({ drawSource: { node }, matrix: node, paged: true }) as unknown as BlendGpuItem

test('a table appended to is the table an open of all its items makes, by exactly the rows added', () => {
  const [a, b, c] = [mesh('a'), mesh('b'), mesh('c')]
  const ra = root([rec(a, 0, 3), rec(a, 1, 1), rec(a, 2, 2)])
  const rb = root([rec(b, 3, 5), rec(b, 4, 4)])
  const rc = root(Array.from({ length: 70 }, (_, index) => rec(c, 5 + index, 70 - index)))
  const packed = [...ra.pages, ...rb.pages, ...rc.pages]
  const items = [item(a), item(b), item(c)]
  const opened = createTransparentTable([ra, rb, rc], packed, items)

  const grown = createTransparentTable([ra], packed, [items[0]])
  const held = { length: grown.length, capacity: grown.capacity }
  grown.append([rb], ra.pages.length, [items[1]])
  // One item's range is its entries, aligned: the table gained exactly that many rows.
  assert.equal(grown.length - held.length, TRANSPARENT_GROUP)
  assert.equal(grown.pagedItems.length, 2)
  grown.append([rc], ra.pages.length + rb.pages.length, [items[2]])
  assert.equal(grown.length - held.length, 3 * TRANSPARENT_GROUP)
  // The rows it held did not move, and the whole is the open's.
  assert.deepEqual(
    [...grown.entries.subarray(0, opened.length)],
    [...opened.entries.subarray(0, opened.length)],
  )
  assert.deepEqual(
    [...grown.pageOfEntry.subarray(0, opened.length)],
    [...opened.pageOfEntry.subarray(0, opened.length)],
  )
  assert.deepEqual([...grown.itemRanges.subarray(0, 6)], [...opened.itemRanges.subarray(0, 6)])
  assert.equal(grown.length, opened.length)
  assert.equal(grown.maxVertexWords, opened.maxVertexWords)
  assert.deepEqual(
    items.map((one) => one.pagedIndex),
    [0, 1, 2],
  )
  for (let page = 0; page < packed.length; page++)
    assert.equal(grown.entryOf(page), opened.entryOf(page))
})

test('a full table doubles, copies the rows it held once, and leaves the entries it gained empty', () => {
  const meshes = Array.from({ length: 5 }, (_, index) => mesh(`m${index}`))
  const roots = meshes.map((source, index) => root([rec(source, index, index)]))
  const packed = roots.flatMap((one) => one.pages)
  const items = meshes.map((source) => item(source))
  const table = createTransparentTable([roots[0]], packed, [items[0]])
  // Each item takes one aligned range: the first fills the table's one group.
  assert.equal(table.capacity, TRANSPARENT_GROUP)
  const first = table.entries
  table.append([roots[1]], 1, [items[1]])
  assert.equal(table.capacity, 2 * TRANSPARENT_GROUP)
  assert.equal(table.entries.length, 2 * TRANSPARENT_GROUP)
  assert.equal(table.groupCount, 2)
  assert.notEqual(table.entries, first)
  assert.equal(table.entries[0], first[0])
  assert.equal(table.entries[TRANSPARENT_GROUP], 1)
  assert.equal(table.pageOfEntry[TRANSPARENT_GROUP + 1], -1)
  table.append([roots[2]], 2, [items[2]])
  assert.equal(table.capacity, 4 * TRANSPARENT_GROUP)
  assert.equal(table.itemRanges.length, 8)
  table.append([roots[3], roots[4]], 3, [items[3], items[4]])
  assert.equal(table.capacity, 8 * TRANSPARENT_GROUP)
  assert.equal(table.itemRanges.length, 12)
  assert.equal(table.length, 5 * TRANSPARENT_GROUP)
})
