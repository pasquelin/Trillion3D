// A row is linked to its world object where its cell moves, and only there: a write that leaves
// its cell links nothing; a row no root reads yet keeps its note for the growth that adopts it, one
// the blend pass draws keeps none. On a generated buffer of 300 rows, a hundred placed by cells.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementRows, growPlacementRows } from './rows.ts'
import { setRowCell, takeCellsMoved } from '../partition/rowCells.ts'
import * as G from '../host/graph/graph.fixture.ts'
import { runtime } from '../webgpu/core/transformShear.fixture.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'

test('the rows whose cell moved are taken once; a row no root reads stays noted', () => {
  const rows = createPlacementRows(300),
    placed = Array.from({ length: 100 }, (_, k) => 3 * k)
  for (const index of placed) setRowCell(rows, index, { cell: index % 7, node: index })
  const seen: number[] = []
  // Rows past 200 have no root yet: a growth brings them.
  takeCellsMoved(rows, (index) => (seen.push(index), index < 200))
  assert.deepEqual(seen, placed)
  // The growth that brings their roots keeps their notes.
  const grown = growPlacementRows(rows, 400)
  const again: number[] = []
  takeCellsMoved(grown, (index) => (again.push(index), true))
  assert.deepEqual(
    again,
    placed.filter((index) => index >= 200),
    'those left noted alone',
  )
  takeCellsMoved(grown, () => assert.fail('nothing moved since'))
})

test('a buffer the blend pass draws keeps no note: no root ever reads its rows', () => {
  const rows = createPlacementRows(300)
  const { rt } = runtime(new G.Object3D(), [])
  Object.assign(rt.blendState, { blendGpu: [{ placement: { rows, index: 0 } }] })
  for (let index = 0; index < 300; index += 3) setRowCell(rows, index, { cell: 0, node: index })
  updateWebgpuPlacements(rt, rows, 0, 0)
  takeCellsMoved(rows, () => assert.fail('no note kept'))
})
