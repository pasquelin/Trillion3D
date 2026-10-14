// A histogram is asked only when what it would bin moved (`rowBinsParams.ts`, `sameAsk`): an ask
// with the inputs of the last one submitted (`bins.asked`) — the same spheres and their buffers,
// rows, motion sums, margin, lamps and suns — would bin the same words; a buffer made anew is a
// new ask. And the pass is one of the shadow stage's (`passRowOf`): the profile counts its time.
import test from 'node:test'
import assert from 'node:assert/strict'
import { commitMotion } from '../gpu/shadow/rowMotion.ts'
import { createVsmRowBound } from './rowPageBound.ts'
import { rowBinsRequest } from './rowBinsParams.ts'
import { scene, sunAt } from './rowPageBound.fixture.ts'
import { onBuffers } from './rowBins.fixture.ts'
import { encodeRowBins } from './rowBinsGpu.ts'
import { passRowOf } from '../stage/passTable.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'

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

// The pass was labelled outside every declared label and family: the profile filed it nowhere.
test('the bins pass files under the shadow stage', async () => {
  const rows = scene(300, [0, 0, 0], 100, 0.01, 30, 1),
    sun = sunAt([0.3, 1.7, -0.2])
  const bound = createVsmRowBound(),
    fake = fakeDevice(),
    on = onBuffers(rows)
  const range = { first: 0, end: rows.packed.length / 8 }
  const encode = () =>
    encodeRowBins(fake.device, fake.device.createCommandEncoder(), bound, on, range, [sun.light])
  encode()
  // The kernel compiles off the thread: the frame after it has, the pass is encoded.
  await new Promise((done) => setTimeout(done, 0))
  encode()
  const labels = fake.computePasses.map((pass) => pass.label!)
  assert.equal(labels.length, 1, 'one bins pass')
  assert.equal(passRowOf(labels[0])?.stage, 'shadows')
})
