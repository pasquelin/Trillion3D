import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementFollow } from './probeSync.ts'
import { NO_PLACEMENT_BOXES } from '../../../geometry/dag/placement/placementBoxes.ts'

/** Probe-side parts that record what a sync asked of them. */
function parts(boxes: number[], moved: number[], extent: number[]) {
  const calls: string[] = []
  const replanned: (readonly number[])[] = []
  return {
    calls,
    replanned,
    boxes: () => ({
      ...NO_PLACEMENT_BOXES,
      boxes: Float64Array.from(boxes),
      moved: { count: moved.length / 2, pairs: Int32Array.from(moved) },
      extent,
    }),
    cascades: {
      replan: (bounds: readonly number[]) => void (calls.push('replan'), replanned.push(bounds)),
    },
    restart: () => void calls.push('restart'),
  }
}

test('nothing moved, nothing is touched; a moved placement places the reach on the new extent and restarts', () => {
  const still = parts([0, 0, 0, 1, 1, 1], [], [0, 0, 0, 1, 1, 1])
  assert.equal(createPlacementFollow(still).sync(), false)
  assert.deepEqual(still.calls, [])
  const moved = parts([0, 0, 0, 1, 1, 1, 5, 5, 5, 6, 7, 8], [1, 1], [0, 0, 0, 6, 7, 8])
  assert.equal(createPlacementFollow(moved).sync(), true)
  // The probes hold no occupancy of the boxes: the extent is all the reach takes.
  assert.deepEqual(moved.calls, ['replan', 'restart'])
  assert.deepEqual(moved.replanned, [[0, 0, 0, 6, 7, 8]])
})
