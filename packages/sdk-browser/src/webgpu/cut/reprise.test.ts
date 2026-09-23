// An incomplete GPU cut must be able to resume on its own. The pending image draws nothing, but
// it requests the missing pages, publishes residency and dispatches selection: without that
// dispatch, the same incomplete readback would come back every image and the cut would stay stuck
// on it, camera still, even once the bytes have arrived.
//
// The complete resume readback is not supplied by the test: it is produced by the mocked
// selection, from the residency flags the pending image published to it. The bench itself
// (`banc()`) lives in `reprise.fixture.ts`, to stay under 200 lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './reprise.fixture.ts';

test('a pending image requests, syncs and dispatches: resume has what it needs to happen', () => {
  const b = banc();
  for (let i = 0; i < 3; i++) assert.equal(b.image(), true, `image ${i}`);
  assert.equal(b.comptes.attentes, 3, 'the three images waited for complete coverage');
  assert.equal(b.rt.gpu.cutIncomplete, true, 'and the cut stayed incomplete, page missing');
  // No pending image merely re-reads: each has advanced the stream.
  assert.equal(b.comptes.queue, 3, 'wanted pages are requested at every wait');
  assert.equal(b.comptes.sync, 3, 'residency is synced at every wait');
  assert.equal(b.comptes.envois, 3, 'selection is dispatched at every wait');
  // The wanted list is published: it is what brings the missing page in.
  assert.deepEqual(
    b.desired.map((p) => p.url),
    ['p0'],
  );
  assert.deepEqual(b.shown, [], 'nothing is drawn from incomplete coverage');
});

test('once the page has arrived, the cut becomes complete again without the camera moving', () => {
  const b = banc();
  b.image();
  assert.equal(b.rt.gpu.cutIncomplete, true);
  // The bytes arrive. The camera has not moved and the budget has not changed.
  b.arrive();
  const envoisAvant = b.comptes.envois;
  assert.equal(b.image(), true, 'the image stays pending: the complete readback is not there yet');
  assert.ok(b.comptes.envois > envoisAvant, 'but it has published residency and dispatched');
  // The next image starts by adopting: it finds the complete readback the wait caused to be
  // produced. The test supplied none.
  b.rt.services.adoptGpuCut();
  assert.equal(b.rt.gpu.cutIncomplete, false, 'coverage is complete');
  assert.deepEqual(
    b.shown.map((p) => p.url),
    ['p0'],
    'and the page is drawn',
  );
});

test('a wait that overflows visibility identifiers falls back to the CPU cut', () => {
  const b = banc('debordement');
  for (let i = 0; i < 3; i++) b.image();
  assert.ok(b.codes.includes('gpu-selection-capacity'), 'capacity is announced');
  assert.ok(b.codes.includes('gpu-selection-fallback'), 'the CPU fallback is announced');
  assert.equal(b.rt.run.gpuSelection, undefined, 'no GPU selection is kept');
  assert.equal(b.comptes.envois, 0, 'no dispatch from a readback that capacity forbids');
  assert.equal(
    b.comptes.attentes,
    0,
    'and the image does not wait for a readback that will never come',
  );
});

test('a wait whose dispatch fails falls back once, it does not retry three times', () => {
  const b = banc('envoi');
  for (let i = 0; i < 3; i++) b.image();
  assert.equal(
    b.codes.filter((code) => code === 'gpu-selection-dispatch-failed').length,
    1,
    'a single failure announced: fallback happened on the first one',
  );
  assert.ok(b.codes.includes('gpu-selection-fallback'), 'the CPU fallback is announced');
  assert.equal(b.rt.run.gpuSelection, undefined, 'no GPU selection is kept');
  assert.equal(b.comptes.envois, 1, 'a single dispatch attempted');
  assert.equal(b.comptes.attentes, 0, 'no image waited');
  assert.deepEqual(b.shown, [], 'nothing is drawn from incomplete coverage');
});
