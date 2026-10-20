// A growth rebinds the blended copies and items that read a row of the old buffer onto the same row
// of the new one — a root and the copy of its placement onto one view (`growRowItems`); a new row's
// copy comes with its root (`pagedBlendCopiesOf`), none is cloned.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBlendCopyRecord } from '../cluster/blendCopyRecord.ts'
import type { DrawSource } from '../page/selection/drawSource.ts'
import type { PageSurface } from '../page/surface.ts'
import { growRowItems, type Rebound } from './growth.ts'
import { createPlacementRows, growPlacementRows, placementWorld } from './rows.ts'

const source = { geometry: {}, frustumCulled: true } as unknown as DrawSource
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
