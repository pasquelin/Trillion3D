// A row knows the cell and node it holds while it holds them: placed, every primitive's row
// of a node names them and the meshes of the cell's nodes; left, none; grown in place, kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { createCellPlacements } from './placements.ts'
import { rowCasting, rowDrawDistance } from '../../placement/rows/rows.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { FAR_SHADOW_ROOT, MARK_BITS } from '../../visibility/shader/castingMark.ts'
import { placedMesh, sizeRows, type RowLink } from './rows.ts'
import { rowCell } from './rowCells.ts'

/** One mesh of two primitives, each its own rows, grown to `capacity` instances. */
function twoPrimitiveMesh(capacity: number) {
  const links: RowLink[] = [
    { meshes: 4, primitives: 0 },
    { meshes: 4, primitives: 1 },
  ]
  const meshes = new Map([[4, placedMesh(links)]])
  sizeRows(meshes, new Map([[4, capacity]]))
  return { links, meshes }
}

/** A cell of two nodes that draw that mesh, none naming a distance, with the columns `columns` set. */
const twoNodeCell = (columns: object = {}) => ({
  nodes: 2,
  ranks: Int32Array.of(-1, 4, -1, 4),
  locals: new Float64Array(32),
  tracks: Int32Array.of(-1, -1),
  sources: new Uint8Array(2),
  sourceNodes: Uint32Array.of(10, 11),
  drawDistances: new Float32Array(6),
  ...columns,
})

test('a row names its cell and node while it holds them, grown or not', () => {
  const { links, meshes } = twoPrimitiveMesh(2)
  const placements = createCellPlacements(G.mesh(), [], meshes, {}, () => 0)
  assert.ok(placements.place(9, twoNodeCell(), 'scene-cell-9.json', 3))
  const held = placements.held.get(9)!
  for (const [node, { row }] of held.entries())
    for (const link of links) {
      const at = rowCell(link.placements!, row)!
      assert.deepEqual([at.cell, at.node], [9, node])
    }
  // Grown in place, the rows keep where they lie.
  const before = links[0].placements!
  sizeRows(meshes, new Map([[4, 5]]))
  assert.notEqual(links[0].placements, before)
  assert.equal(rowCell(links[0].placements!, held[1].row)?.node, 1)
  placements.leave(9)
  for (const { row } of held) assert.equal(rowCell(links[1].placements!, row), undefined)
})

test('a node that casts far shadows has its rows cast them, whatever its host mesh says, and keeps them when the rows are written again', () => {
  const { links, meshes } = twoPrimitiveMesh(4)
  const frame: { hidden?: boolean } = {}
  const placements = createCellPlacements(G.mesh(), [], meshes, frame, () => 0)
  const cell = twoNodeCell({ castFarShadows: Uint8Array.of(0, 1) })
  assert.ok(placements.place(9, cell, 'scene-cell-9.json', 3))
  const held = placements.held.get(9)!
  const casting = (node: number, link: number) =>
    rowCasting({ rows: links[link].placements!, index: held[node].row })
  for (const link of [0, 1]) {
    assert.equal(casting(0, link) & FAR_SHADOW_ROOT, 0, 'the first node casts none')
    assert.equal(casting(1, link) & FAR_SHADOW_ROOT, FAR_SHADOW_ROOT, 'the second casts them')
  }
  // The frame hides the rows, which writes them again: the flag is kept.
  frame.hidden = true
  placements.follow()
  assert.equal(links[0].placements!.live[held[1].row], 0, 'the rows were written again')
  assert.equal(casting(1, 0) & FAR_SHADOW_ROOT, FAR_SHADOW_ROOT)
  assert.equal(casting(0, 0) & FAR_SHADOW_ROOT, 0)
})

test('a node that names a far-shadow test has its rows reached by it or never, unless its host mesh says, and keeps it when the rows are written again', () => {
  const host = object.mesh(new Geometry())
  host.farShadowTest = false
  const links: RowLink[] = [{ meshes: 4, primitives: 0 }]
  const meshes = new Map([[4, placedMesh(links, [host])]])
  sizeRows(meshes, new Map([[4, 4]]))
  const frame: { hidden?: boolean } = {}
  const placements = createCellPlacements(G.mesh(), [], meshes, frame, () => 0)
  const cell = {
    nodes: 3,
    ranks: Int32Array.of(-1, 4, -1, 4, -1, 4),
    locals: new Float64Array(48),
    tracks: Int32Array.of(-1, -1, -1),
    sources: new Uint8Array(3),
    sourceNodes: Uint32Array.of(10, 11, 12),
    drawDistances: new Float32Array(9),
    farShadowTests: Uint8Array.of(0, 1, 2),
  }
  assert.ok(placements.place(9, cell, 'scene-cell-9.json', 3))
  const held = placements.held.get(9)!
  const casting = (node: number) =>
    rowCasting({ rows: links[0].placements!, index: held[node].row }) &
    (MARK_BITS.farTest | MARK_BITS.farSkip)
  // The host mesh says never: that wins over the compiled `true`.
  assert.deepEqual([0, 1, 2].map(casting), [
    MARK_BITS.farSkip,
    MARK_BITS.farSkip,
    MARK_BITS.farSkip,
  ])
  // Without the host mesh's word the compiled one stands: none, reached, never.
  host.farShadowTest = null
  placements.follow()
  assert.deepEqual([0, 1, 2].map(casting), [0, MARK_BITS.farTest, MARK_BITS.farSkip])
  frame.hidden = true
  placements.follow()
  assert.deepEqual(
    [0, 1, 2].map(casting),
    [0, MARK_BITS.farTest, MARK_BITS.farSkip],
    'kept when written',
  )
})

test('the distances a node names are seated on its rows, grown with them and cleared when left', () => {
  const { links, meshes } = twoPrimitiveMesh(4)
  const placements = createCellPlacements(G.mesh(), [], meshes, {}, () => 0)
  const cell = (drawDistances: number[]) =>
    twoNodeCell({ drawDistances: Float32Array.from(drawDistances) })
  const distances = (row: number, link = 0) =>
    rowDrawDistance({ rows: links[link].placements!, index: row })
  // No node names one: no column is made.
  assert.ok(placements.place(8, cell([0, 0, 0, 0, 0, 0]), 'scene-cell-8.json', 3))
  assert.equal(links[0].placements!.drawDistance, undefined, 'a scene without distances pays none')
  // The second node names its own, on the rows of every primitive; the first a nearest alone, of
  // an object of its own.
  assert.ok(placements.place(9, cell([6, 0, 0, 2, 50, 1]), 'scene-cell-9.json', 3))
  const held = placements.held.get(9)!
  for (const link of [0, 1]) {
    assert.deepEqual(distances(held[1].row, link), { min: 2, max: 50, perInstance: true })
    assert.deepEqual(distances(held[0].row, link), { min: 6, max: 0, perInstance: false })
  }
  // Grown in place, the rows keep their distances.
  sizeRows(meshes, new Map([[4, 8]]))
  assert.deepEqual(distances(held[1].row), { min: 2, max: 50, perInstance: true })
  // Left, the rows name none.
  const rows = [...held].map(({ row }) => row)
  placements.leave(9)
  for (const row of rows) assert.equal(distances(row), undefined)
})

test('the group above the root of an instance is seated on the rows of its primitive, grown and cleared with them', () => {
  const { links, meshes } = twoPrimitiveMesh(4)
  const placements = createCellPlacements(G.mesh(), [], meshes, {}, () => 0)
  const cell = (rootParents?: Float32Array) => twoNodeCell(rootParents && { rootParents })
  const parent = (row: number, link = 0) =>
    Array.from(links[link].placements!.rootParent?.subarray(5 * row, 5 * row + 5) ?? [])
  // No node is an instance: no column is made.
  assert.ok(placements.place(8, cell(), 'scene-cell-8.json', 3))
  assert.equal(links[0].placements!.rootParent, undefined, 'a scene without assemblies pays none')
  // The second node names a group above the root of its second primitive alone.
  const entry = [1, 1, 6.5, 1.25, -2, 3, 40]
  assert.ok(placements.place(9, cell(Float32Array.from(entry)), 'scene-cell-9.json', 3))
  const held = placements.held.get(9)!
  assert.deepEqual(parent(held[1].row, 1), [6.5, 1.25, -2, 3, 40])
  assert.deepEqual(parent(held[1].row, 0), [], 'the first primitive pays no column')
  assert.deepEqual(parent(held[0].row, 1), [0, 0, 0, 0, 0])
  // Grown in place, the rows keep it; left, they name none.
  sizeRows(meshes, new Map([[4, 8]]))
  assert.deepEqual(parent(held[1].row, 1), [6.5, 1.25, -2, 3, 40])
  const rows = [...held].map(({ row }) => row)
  placements.leave(9)
  for (const row of rows) assert.deepEqual(parent(row, 1), [0, 0, 0, 0, 0])
})

test('the source nodes the placed cells draw follow the cells placed and left, and the rows drawn as an HLOD 0 actor', () => {
  const { meshes } = twoPrimitiveMesh(8)
  const placements = createCellPlacements(G.mesh(), [], meshes, {}, () => 0)
  const { draws } = placements
  const drawn = () => [10, 11, 12].map(draws.drawn)
  assert.deepEqual(drawn(), [false, false, false], 'no cell placed')
  assert.ok(placements.place(8, twoNodeCell(), 'scene-cell-8.json', 3))
  assert.deepEqual(drawn(), [true, true, false], 'the two source nodes its rows draw')
  const placed = draws.changes
  // A second cell draws node 11 too: it stays drawn while either does.
  assert.ok(placements.place(9, twoNodeCell({ sourceNodes: Uint32Array.of(11, 12) }), 'b.json', 3))
  assert.deepEqual(drawn(), [true, true, true])
  assert.ok(draws.changes > placed, 'a move is counted')
  // Its rows drawing its HLOD 0 actor, a cell draws no node as itself; told twice, it counts once.
  placements.proxy(8, true)
  placements.proxy(8, true)
  assert.deepEqual(drawn(), [false, true, true], 'node 11 is still drawn by the other cell')
  placements.proxy(8, false)
  assert.deepEqual(drawn(), [true, true, true])
  placements.proxy(8, true)
  // Left drawing an actor, it takes back nothing it no longer drew.
  placements.leave(8)
  assert.deepEqual(drawn(), [false, true, true])
  placements.leave(9)
  assert.deepEqual(drawn(), [false, false, false], 'every cell left')
})
