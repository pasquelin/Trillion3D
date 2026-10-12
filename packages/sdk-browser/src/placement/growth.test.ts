// A growth rebinds the blended copies and items that read a row of the old buffer onto the same row
// of the new one — a root and the copy of its placement onto one view —, and a copy per new row is
// cloned from a copy of the buffer (`growRowCopies`, `growRowItems`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBlendCopyRecord } from '../cluster/blendCopyRecord.ts'
import type { DrawSource } from '../page/selection/drawSource.ts'
import type { PageSurface } from '../page/surface.ts'
import { growRowCopies, growRowItems, type Rebound } from './growth.ts'
import { createPlacementRows, growPlacementRows, placementWorld } from './rows.ts'

const source = { geometry: {}, frustumCulled: true } as unknown as DrawSource
const surface = {} as PageSurface

test('copies and items of a buffer read the larger one, a parked copy joins per new row', () => {
  const from = createPlacementRows(2),
    to = growPlacementRows(from, 5)
  const copies = [0, 1].map((index) =>
    createBlendCopyRecord(source, 7, placementWorld(from, index), surface, { rows: from, index }),
  )
  const items = copies.map((copy) => ({ matrix: copy.matrix, placement: copy.placement }))
  const rebound: Rebound = new Map()
  const added = growRowCopies(copies, from, to, rebound)
  growRowItems(items, from, to, rebound)
  assert.equal(added.length, to.capacity - from.capacity, 'one copy per new row')
  copies.forEach((copy, index) => {
    assert.equal(copy.placement?.rows, to)
    assert.equal(
      (copy.matrix.elements as Float64Array).buffer,
      to.matrices.buffer,
      'a view on the larger buffer',
    )
    assert.equal(items[index].matrix, copy.matrix, 'its item stands on the same view')
  })
  added.forEach((copy, k) => {
    assert.equal(copy.placement?.index, from.capacity + k)
    assert.equal(copy.renderOrder, 7)
  })
})
