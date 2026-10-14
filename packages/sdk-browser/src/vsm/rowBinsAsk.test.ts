// A histogram is asked only when what it would bin moved (`rowBinsParams.ts`, `sameAsk`): an ask
// with the inputs of the last one submitted (`bins.asked`) — the same spheres and their buffers,
// rows, motion sums, margin, lamps and suns — would bin the same words. The old pass binned every
// row again each frame a staging buffer was free, a still scene's included; then a buffer made anew
// was told apart beside the ask, by the pass, no longer by the ask itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { commitMotion } from '../gpu/shadow/rowMotion.ts'
import { createVsmRowBound } from './rowPageBound.ts'
import { rowBinsRequest } from './rowBinsParams.ts'
import { scene, sunAt } from './rowPageBound.fixture.ts'
import { onBuffers } from './rowBins.fixture.ts'

test('an ask of the last encoded inputs is not made again; a change of any is', () => {
  const rows = scene(300, [0, 0, 0], 100, 0.01, 30, 1),
    sun = sunAt([0.3, 1.7, -0.2])
  const { bins } = createVsmRowBound(),
    { motion } = rows.spheres
  const range = { first: 0, end: rows.packed.length / 8 }
  const on = onBuffers(rows)
  const ask = () => rowBinsRequest(bins, on, range, [sun.light])
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
  on.mobility = {} as GPUBuffer
  const remade = ask()
  assert.ok(remade, 'a mobility buffer made anew')
  bins.asked = remade.tag
  assert.equal(ask(), undefined)
  on.spheres = {} as GPUBuffer
  assert.ok(ask(), 'a sphere buffer made anew')
  range.end -= 1
  assert.ok(ask(), 'other rows')
})
