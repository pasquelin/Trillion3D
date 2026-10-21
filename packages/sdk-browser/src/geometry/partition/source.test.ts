// A square cell's rank by distance weighs the angle between the view's heading and the way to the
// cell: a corner exactly along the heading makes a scalar product of unit vectors that rounds a
// hair over one, which an arc cosine would turn into no number at all.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { createStreamingSource } from './source.ts'
import type { LoadingCell } from './loadSlots.ts'

test('a square cell straight ahead of the heading is ranked by a number, its angle zero', () => {
  const source = createStreamingSource(resolveWorldStreaming({}), {
    scheme: 'spatialHash',
    flat: true,
  })
  // The heading (1, 6) over its length, the cell's near corner (20, 120) on it: the scalar product
  // of the two unit vectors is 1 + 4.4e-16.
  source.set([0, 0, 0], [1, 0, 6])
  const bounds = [20, 0, 120, 30, 1, 130]
  const out: LoadingCell = { key: 0, extent: 0, level: 0, priority: 0, distance: 0, raw: 0 }
  source.ranked(bounds, 0, 50, out)
  assert.ok(Number.isFinite(out.distance), `distance ${out.distance}`)
  const expected = (25 ** 2 + 125 ** 2) * (Math.PI / 180) ** (2 * 0.4)
  assert.ok(Math.abs(out.distance - expected) / expected < 1e-9, `${out.distance} vs ${expected}`)
})
