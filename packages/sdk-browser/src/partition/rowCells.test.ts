// A row knows the cell and node it holds while it holds them: placed, every primitive's row
// of a node names them and the meshes of the cell's nodes; left, none; grown in place, kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
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
  const placements = createCellPlacements(G.mesh(), [], meshes)
  const cell = { nodes: 2, ranks: Int32Array.of(-1, 4, -1, 4), locals: new Float64Array(32) }
  assert.ok(placements.place(9, cell, 'scene-cell-9.json'))
  const held = placements.held.get(9)!
  for (const [node, { row }] of held.entries())
    for (const link of links) {
      const at = rowCell(link.placements!, row)!
      assert.deepEqual([at.cell, at.node, [...at.meshes]], [9, node, [4, 4]])
    }
  // Grown in place, the rows keep where they lie.
  const before = links[0].placements!
  sizeRows(meshes, new Map([[4, 5]]))
  assert.notEqual(links[0].placements, before)
  assert.equal(rowCell(links[0].placements!, held[1].row)?.node, 1)
  placements.leave(9)
  for (const { row } of held) assert.equal(rowCell(links[1].placements!, row), undefined)
})
