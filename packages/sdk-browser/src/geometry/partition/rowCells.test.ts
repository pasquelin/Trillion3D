// A row knows the cell and node it holds while it holds them: placed, every primitive's row
// of a node names them and the meshes of the cell's nodes; left, none; grown in place, kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { createCellPlacements } from './placements.ts'
import { placedMesh, sizeRows, type RowLink } from './rows.ts'
import { rowCell } from './rowCells.ts'

test('a row names its cell and node while it holds them, grown or not', () => {
  // One mesh of two primitives, each its own rows.
  const links: RowLink[] = [
    { meshes: 4, primitives: 0 },
    { meshes: 4, primitives: 1 },
  ]
  const meshes = new Map([[4, placedMesh(links)]])
  sizeRows(meshes, new Map([[4, 2]]))
  const placements = createCellPlacements(G.mesh(), [], meshes, {}, () => 0)
  const cell = {
    nodes: 2,
    ranks: Int32Array.of(-1, 4, -1, 4),
    locals: new Float64Array(32),
    tracks: Int32Array.of(-1, -1),
    sources: new Uint8Array(2),
    drawDistances: new Float32Array(4),
  }
  assert.ok(placements.place(9, cell, 'scene-cell-9.json', 3))
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

test('the distances a node names are seated on its rows, grown with them and cleared when left', () => {
  const links: RowLink[] = [
    { meshes: 4, primitives: 0 },
    { meshes: 4, primitives: 1 },
  ]
  const meshes = new Map([[4, placedMesh(links)]])
  sizeRows(meshes, new Map([[4, 4]]))
  const placements = createCellPlacements(G.mesh(), [], meshes, {}, () => 0)
  const cell = (drawDistances: number[]) => ({
    nodes: 2,
    ranks: Int32Array.of(-1, 4, -1, 4),
    locals: new Float64Array(32),
    tracks: Int32Array.of(-1, -1),
    sources: new Uint8Array(2),
    drawDistances: Float32Array.from(drawDistances),
  })
  const distances = (row: number, link = 0) =>
    Array.from(links[link].placements!.drawDistance?.subarray(2 * row, 2 * row + 2) ?? [])
  // No node names one: no column is made.
  assert.ok(placements.place(8, cell([0, 0, 0, 0]), 'scene-cell-8.json', 3))
  assert.equal(links[0].placements!.drawDistance, undefined, 'a scene without distances pays none')
  // The second node names its own, on the rows of every primitive.
  assert.ok(placements.place(9, cell([0, 0, 2, 50]), 'scene-cell-9.json', 3))
  const held = placements.held.get(9)!
  for (const link of [0, 1]) assert.deepEqual(distances(held[1].row, link), [2, 50])
  assert.deepEqual(distances(held[0].row), [0, 0])
  // Grown in place, the rows keep their distances.
  sizeRows(meshes, new Map([[4, 8]]))
  assert.deepEqual(distances(held[1].row), [2, 50])
  // Left, the rows name none.
  const rows = [...held].map(({ row }) => row)
  placements.leave(9)
  for (const row of rows) assert.deepEqual(distances(row), [0, 0])
})

test('the group above the root of an instance is seated on the rows of its primitive, grown and cleared with them', () => {
  const links: RowLink[] = [
    { meshes: 4, primitives: 0 },
    { meshes: 4, primitives: 1 },
  ]
  const meshes = new Map([[4, placedMesh(links)]])
  sizeRows(meshes, new Map([[4, 4]]))
  const placements = createCellPlacements(G.mesh(), [], meshes, {}, () => 0)
  const cell = (rootParents?: Float32Array) => ({
    nodes: 2,
    ranks: Int32Array.of(-1, 4, -1, 4),
    locals: new Float64Array(32),
    tracks: Int32Array.of(-1, -1),
    sources: new Uint8Array(2),
    drawDistances: new Float32Array(4),
    ...(rootParents && { rootParents }),
  })
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
