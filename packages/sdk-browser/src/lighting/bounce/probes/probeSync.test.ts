import test from 'node:test'
import assert from 'node:assert/strict'
import { createProxyFollow, NO_PROXY_BOXES } from './probeSync.ts'

/** Probe-side parts that record what a sync asked of them. */
function parts(boxes: number[], moved: number[], extent: number[]) {
  const calls: string[] = []
  const replanned: (readonly number[])[] = []
  return {
    calls,
    replanned,
    boxes: () => ({
      ...NO_PROXY_BOXES,
      boxes: Float64Array.from(boxes),
      moved: { count: moved.length / 2, pairs: Int32Array.from(moved) },
      extent,
    }),
    cascades: {
      replan: (bounds: readonly number[]) => (calls.push('replan'), replanned.push(bounds), true),
    },
    restart: () => void calls.push('restart'),
  }
}

test('nothing moved, nothing is touched; a moved placement places the lattice on the new extent and restarts', () => {
  const still = parts([0, 0, 0, 1, 1, 1], [], [0, 0, 0, 1, 1, 1])
  assert.equal(createProxyFollow(still).sync(), false)
  assert.deepEqual(still.calls, [])
  const moved = parts([0, 0, 0, 1, 1, 1, 5, 5, 5, 6, 7, 8], [1, 1], [0, 0, 0, 6, 7, 8])
  assert.equal(createProxyFollow(moved).sync(), true)
  // The probes hold no occupancy of the boxes: the extent is all the light grid and the reach take.
  assert.deepEqual(moved.calls, ['replan', 'restart'])
  assert.deepEqual(moved.replanned, [[0, 0, 0, 6, 7, 8]])
})
