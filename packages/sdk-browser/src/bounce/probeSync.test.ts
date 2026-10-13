import test from 'node:test'
import assert from 'node:assert/strict'
import { syncBounceProbes } from './probeSync.ts'

/** Probe-side parts that record what a sync asked of them. */
function parts(boxes: number[], moved: number[], extent: number[]) {
  const calls: string[] = []
  return {
    calls,
    boxes: () => ({
      boxes: Float64Array.from(boxes),
      moved: { count: moved.length / 2, pairs: Int32Array.from(moved) },
      extent,
    }),
    cascades: { replan: () => (calls.push('replan'), true), invalidLevels: 1 },
    occupancy: { moved: () => void calls.push('occupancy') },
    invalidate: () => void calls.push('invalidate'),
    restart: () => void calls.push('restart'),
  }
}

test('nothing moved, nothing is touched; a moved placement replans, marks and restarts', () => {
  const still = parts([0, 0, 0, 1, 1, 1], [], [0, 0, 0, 1, 1, 1])
  assert.equal(syncBounceProbes(still), undefined)
  assert.deepEqual(still.calls, [])
  const moved = parts([0, 0, 0, 1, 1, 1, 5, 5, 5, 6, 7, 8], [1, 1], [0, 0, 0, 6, 7, 8])
  const change = syncBounceProbes(moved)
  assert.deepEqual(moved.calls, ['replan', 'invalidate', 'occupancy', 'restart'])
  assert.deepEqual(change?.extent, [0, 0, 0, 6, 7, 8])
})
