// An owner that moves an instance row names its placement beside the write of its world: the cut's
// placement tree fits that group again — or it keeps the old pose and culls the instance — and
// the next image sends that world alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { runtime, selectionRoot } from '../webgpu/core/transformShear.fixture.ts'
import { createPlacementRows, placementWorld } from './rows.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'
import { takeSorted } from '../webgpu/cut/denseKeys.ts'

test('a row its owner moves names its placement to the tree and to the next upload', () => {
  const rows = createPlacementRows(2)
  const roots = [0, 1].map((index) => {
    rows.matrices.set(new G.Matrix4().makeTranslation(index * 10, 0, 0).elements, index * 16)
    rows.live[index] = 1
    const root = selectionRoot(new G.Object3D(), [-1, -1, -1, 1, 1, 1], {
      of: () => placementWorld(rows, index),
    } as never)
    return Object.assign(root, { placement: { rows, index } })
  })
  const { rt } = runtime(new G.Object3D(), roots)
  Object.assign(rt.blendState, { blendGpu: [] })
  rt.lights.mobility.ensure(2, 2, (rank) => roots[rank].world.elements)
  const told: number[] = []
  rt.run.gpuSelection = { placementMoved: (w: number) => void told.push(w) } as never
  rows.matrices.set(new G.Matrix4().makeTranslation(25, 0, 0).elements, 16)
  updateWebgpuPlacements(rt, rows, 1, 1)
  assert.deepEqual(told, [1], 'the tree fits its group again')
  assert.deepEqual([...takeSorted(rt.run.movedWorlds)], [1], 'its world alone goes up')
})
