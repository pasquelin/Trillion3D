// An image waiting for its root cover must be able to resume on its own. The pending image draws
// nothing, but it requests the missing pages, publishes residency and dispatches selection: without
// that dispatch, the same readback would come back every image and the cut would stay stuck on it,
// camera still, even once the bytes have arrived.
//
// The resume readback is not supplied by the test: it is produced by the mocked selection, from
// the residency flags the pending image published to it. The bench itself (`banc()`) lives in
// `resume.fixture.ts`, to stay under 200 lines.
import test from 'node:test'
import assert from 'node:assert/strict'
import { banc } from './resume.fixture.ts'

test('a pending image requests, syncs and dispatches: resume has what it needs to happen', () => {
  const b = banc()
  for (let i = 0; i < 3; i++) b.image()
  assert.equal(b.comptes.attentes, 3, 'the three images waited for the root cover')
  // No pending image merely re-reads: each has advanced the stream.
  assert.equal(b.comptes.queue, 3, 'wanted pages are requested at every wait')
  assert.equal(b.comptes.sync, 3, 'residency is synced at every wait')
  assert.equal(b.comptes.envois, 3, 'selection is dispatched at every wait')
  // The wanted list is published: it is what brings the missing page in.
  assert.deepEqual(
    b.desired.map((p) => p.url),
    ['p0'],
  )
  assert.deepEqual(b.shown, [], 'nothing is drawn before the root cover')
})

test('once a page has arrived, the next readback draws it without the camera moving', () => {
  const b = banc()
  b.image()
  // The bytes arrive. The camera has not moved and the budget has not changed.
  b.arrive()
  const envoisAvant = b.comptes.envois
  // The image stays pending: the readback is not there yet.
  b.image()
  assert.ok(b.comptes.envois > envoisAvant, 'but it has published residency and dispatched')
  // The next image starts by adopting: it finds the readback that dispatch produced. The test
  // supplied none.
  b.rt.services.adoptGpuCut()
  assert.deepEqual(
    b.shown.map((p) => p.url),
    ['p0'],
    'and the page is drawn',
  )
})

// #1483: a send that fails is said and the image skipped; only `device.lost` declares a loss.
test('a wait whose dispatch fails is said once and skips the image, the device kept', () => {
  const b = banc('envoi')
  b.image()
  assert.equal(b.codes.filter((code) => code === 'gpu-selection-dispatch-failed').length, 1)
  assert.ok(!b.codes.includes('gpu-device-lost'), 'no loss announced')
  assert.equal(b.rt.run.lost, false, 'the session stays on its device')
  assert.deepEqual(b.shown, [], 'nothing is drawn before the root cover')
})
