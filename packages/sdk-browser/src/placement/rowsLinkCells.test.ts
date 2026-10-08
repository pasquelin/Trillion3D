// A row is linked to its world object where its cell moves, and only there: a write that leaves
// its cell links nothing; a row no root reads yet keeps its note for the growth that adopts it. On
// a generated buffer of 300 rows, a hundred placed by cells.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementRows, growPlacementRows } from './rows.ts'
import { setRowCell, takeCellsMoved } from '../partition/rowCells.ts'

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
