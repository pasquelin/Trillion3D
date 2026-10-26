// A growth rebinds the blended copies and items that read a row of the old buffer onto the same row
// of the new one — a root and the copy of its placement onto one view (`growRowItems`); a new row's
// copy comes with its root (`pagedBlendCopiesOf`), none is cloned. The rows' optional columns grow
// with them, and a cut short of nodes asks for another.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBlendCopyRecord } from '../../geometry/cluster/blendCopyRecord.ts'
import type { DrawSource } from '../../geometry/selection/drawSource.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import { growRowItems, type Rebound } from './growth.ts'
import {
  createPlacementRows,
  growPlacementRows,
  placementWorld,
  rowColumn,
  rowRootParent,
  seatRootParent,
} from '../rows/rows.ts'
import { askNodeRoom } from './growthOf.ts'
import { DRAW_DISTANCE_STRIDE } from '../../geometry/dag/drawDistance.ts'
import { startGrownCut } from './grownCutStart.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

const source = { geometry: {} } as unknown as DrawSource
const surface = {} as PageSurface

test('copies and items of a buffer read the larger one, on one view, and none is cloned', () => {
  const from = createPlacementRows(2),
    to = growPlacementRows(from, 5)
  const copies = [0, 1].map((index) =>
    createBlendCopyRecord(source, 7, placementWorld(from, index), surface, { rows: from, index }),
  )
  const items = copies.map((copy) => ({ matrix: copy.matrix, placement: copy.placement }))
  const rebound: Rebound = new Map()
  growRowItems(copies, from, to, rebound)
  growRowItems(items, from, to, rebound)
  assert.equal(copies.length, 2, 'no copy cloned')
  copies.forEach((copy, index) => {
    assert.equal(copy.placement?.rows, to)
    assert.equal(
      (copy.matrix.elements as Float64Array).buffer,
      to.matrices.buffer,
      'a view on the larger buffer',
    )
    assert.equal(items[index].matrix, copy.matrix, 'its item stands on the same view')
  })
})

test('the optional columns of the rows grow with them: copied where they exist, every new row unset', () => {
  const from = createPlacementRows(2)
  assert.equal(growPlacementRows(from, 5).tracks, undefined, 'a column no row named stays absent')
  rowColumn(from, 'tracks')[1] = 3
  rowColumn(from, 'drawDistance').set([2, 50], 2)
  rowColumn(from, 'farField')[0] = 1
  seatRootParent(from, 1, { error: 6.5, sphere: [1.25, -2, 3, 40] })
  const to = growPlacementRows(from, 5)
  // Each column holds its stride in values for every row of the buffer, no more.
  const rows = to.capacity
  assert.deepEqual(
    [to.tracks!.length, to.drawDistance!.length, to.farField!.length, to.rootParent!.length],
    [rows, DRAW_DISTANCE_STRIDE * rows, rows, 5 * rows],
  )
  assert.deepEqual(Array.from(to.tracks!), [-1, 3, -1, -1, -1].slice(0, to.capacity), 'unset: -1')
  assert.deepEqual(Array.from(to.drawDistance!.subarray(0, 6)), [0, 0, 2, 50, 0, 0])
  assert.equal(to.farField![0], 1)
  assert.deepEqual(rowRootParent({ rows: to, index: 1 }), {
    error: 6.5,
    sphere: [1.25, -2, 3, 40],
  })
  assert.equal(rowRootParent({ rows: to, index: 4 }), undefined, 'a new row names none')
})

test('a group the running cut has no node for asks for a cut with room, and no root joins in place', async () => {
  let appended = 0
  const refused: string[] = []
  const rt = {
    run: {
      gpuSelection: { growing: false, appendRoots: () => (appended++, true) },
      movedWorlds: {},
    },
    layout: { selectionRoots: [], packedPages: [] },
    gpu: {},
    signal: new AbortController().signal,
    context: { onContentRefused: (what: string) => refused.push(what) },
  } as never as WebgpuPagesRuntime
  askNodeRoom(rt)
  assert.deepEqual([rt.growth?.asked, rt.growth?.starved], [true, true])
  startGrownCut(rt)
  assert.equal(appended, 0, 'the running cut takes none in place')
  assert.ok(rt.growth?.making, 'a cut with room is made')
  assert.equal(rt.growth?.starved, undefined, 'asked once')
  await rt.growth?.making
  assert.equal(
    refused.length,
    1,
    "the cut was attempted over the roots it holds, and the device's refusal told",
  )
})
