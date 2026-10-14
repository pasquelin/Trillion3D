// A histogram is asked only when what it would bin moved (`rowBinsParams.ts`, `sameAsk`): an ask
// with the inputs of the last one encoded (`bins.asked`) — the same spheres, rows, motion sums,
// margin, lamps and suns — would bin the same words. The old pass binned every row again each frame
// a staging buffer was free, a still scene's included.
import test from 'node:test'
import assert from 'node:assert/strict'
import { commitMotion } from '../gpu/shadow/rowMotion.ts'
import { createVsmRowBound } from './rowPageBound.ts'
import { rowBinsRequest } from './rowBinsParams.ts'
import { scene, sunAt } from './rowPageBound.fixture.ts'

test('an ask of the last encoded inputs is not made again; a change of any is', () => {
  const rows = scene(300, [0, 0, 0], 100, 0.01, 30, 1),
    sun = sunAt([0.3, 1.7, -0.2])
  const { bins } = createVsmRowBound(),
    { motion } = rows.spheres
  const range = { first: 0, end: rows.packed.length / 8 }
  const ask = () => rowBinsRequest(bins, rows.spheres, range, [sun.light])
  const first = ask()
  assert.ok(first, 'the first frame asks')
  assert.ok(ask(), 'none encoded yet: asked again')
  bins.asked = first.tag
  assert.equal(ask(), undefined, 'the inputs of the one encoded')
  commitMotion(motion, 0, 0)
  assert.equal(ask(), undefined, 'a still frame: one more commit, nothing derived, nothing moved')
  commitMotion(motion, 1, 0)
  const derived = ask()
  assert.ok(derived, 'a row derived since')
  bins.asked = derived.tag
  assert.equal(ask(), undefined)
  range.end -= 1
  assert.ok(ask(), 'other rows')
})
