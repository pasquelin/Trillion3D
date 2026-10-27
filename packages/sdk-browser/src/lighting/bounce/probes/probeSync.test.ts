import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementFollow } from './probeSync.ts'
import { NO_PLACEMENT_BOXES } from '../../../geometry/dag/placement/placementBoxes.ts'

/** Probe-side parts that record what a sync asked of them. */
function parts(boxes: number[], moved: number[], extent: number[]) {
  const calls: string[] = []
  return {
    calls,
    boxes: () => ({
      ...NO_PLACEMENT_BOXES,
      boxes: Float64Array.from(boxes),
      moved: { count: moved.length / 2, pairs: Int32Array.from(moved) },
      extent,
    }),
    restart: () => void calls.push('restart'),
  }
}

test('nothing moved, nothing is touched; a moved placement restarts the series', () => {
  const still = parts([0, 0, 0, 1, 1, 1], [], [0, 0, 0, 1, 1, 1])
  assert.equal(createPlacementFollow(still).sync(), false)
  assert.deepEqual(still.calls, [])
  const moved = parts([0, 0, 0, 1, 1, 1, 5, 5, 5, 6, 7, 8], [1, 1], [0, 0, 0, 6, 7, 8])
  assert.equal(createPlacementFollow(moved).sync(), true)
  assert.deepEqual(moved.calls, ['restart'])
})
