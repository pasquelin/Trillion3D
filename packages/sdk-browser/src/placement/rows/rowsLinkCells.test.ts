// A row is linked to its HLOD 0 cell where its cell moves, and only there: a write that leaves
// its cell links nothing; a row no root reads yet keeps its note for the growth that adopts it, one
// the blend pass draws keeps none, unless a root reads it too. On a generated buffer of 300 rows,
// a hundred placed by cells.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementRows, growPlacementRows, placementWorld } from './rows.ts'
import { setRowCell, takeCellsMoved } from '../../geometry/partition/rowCells.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { runtime, selectionRoot } from '../../gpu/core/transformShear.fixture.ts'
import { updateWebgpuPlacements } from '../webgpuPlacements.ts'

test('the rows whose cell moved are taken once; a row no root reads stays noted', () => {
  const rows = createPlacementRows(300),
    placed = Array.from({ length: 100 }, (_, k) => 3 * k)
  for (const index of placed)
    setRowCell(rows, index, { cell: index % 7, node: index, instance: 0, hlod: 0, proxy: false })
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
  const { rt } = runtime(new Object3D(), [])
  Object.assign(rt.blendState, { blendGpu: [{ placement: { rows, index: 0 } }] })
  rows.blended = true
  for (let index = 0; index < 300; index += 3)
    setRowCell(rows, index, { cell: 0, node: index, instance: 0, hlod: 0, proxy: false })
  updateWebgpuPlacements(rt, rows, 0, 0)
  takeCellsMoved(rows, () => assert.fail('no note kept'))
})

test('a row both a root and the blend pass read is linked: a mesh opaque and transparent at once', () => {
  const rows = createPlacementRows(4)
  const roots = [0, 1].map((index) => {
    rows.live[index] = 1
    const root = selectionRoot(new Object3D(), [-1, -1, -1, 1, 1, 1], {
      of: () => placementWorld(rows, index),
    } as never)
    return Object.assign(root, { placement: { rows, index } })
  })
  const { rt } = runtime(new Object3D(), roots)
  rt.lights.mobility.ensure(2, (rank) => roots[rank].world.elements)
  Object.assign(rt.blendState, { blendGpu: [{ placement: { rows, index: 1 } }] })
  rows.blended = true
  const linked: number[] = []
  rt.run.gpuSelection = {
    world: {},
    placeInCell: (w: number) => void linked.push(w),
    waitRow() {},
  } as never
  setRowCell(rows, 1, { cell: 0, node: 1, instance: 0, hlod: 0, proxy: false })
  setRowCell(rows, 3, { cell: 0, node: 3, instance: 0, hlod: 0, proxy: false })
  updateWebgpuPlacements(rt, rows, 1, 1)
  assert.deepEqual(linked, [1], 'its opaque root linked')
  takeCellsMoved(rows, () => assert.fail('the blended row no root reads keeps no note'))
})
