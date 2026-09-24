import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { fakeDevice, written, type FakeWrite } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createPlacementMotion } from './motion.ts';

/** The writes of a device: byte offset → floats written. */
const floats = (writes: FakeWrite[]) =>
  writes.map((write) => ({ offset: write.offset, data: [...written(write)] }));

const IDENTITY = [...IDENTITY_MATRIX4];
const translation = (x: number, y: number, z: number) => ({
  world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] },
});

test('a still root keeps identity, a moved root carries previous·current⁻¹, in one write', () => {
  const { device, writes } = fakeDevice();
  const fixe = translation(1, 2, 3),
    mobile = translation(0, 0, 0);
  const motion = createPlacementMotion(device, [fixe, mobile]);
  // One write at creation: the whole mirror, at identity.
  assert.equal(writes.length, 1);
  assert.deepEqual(floats(writes)[0], { offset: 0, data: [...IDENTITY, ...IDENTITY] });
  writes.length = 0;
  // Nothing moved and the scene did not change: no comparison, no write.
  motion.update([10, 20, 30], false);
  assert.equal(writes.length, 0);
  assert.equal(motion.moved, false);
  // The second root advances by (4, 0, 0): M brings a current point back to its previous place,
  // a translation of −4 — which eye anchoring does not change for a pure translation. One
  // write, on the only range touched.
  mobile.world.elements[12] = 4;
  motion.update([10, 20, 30], true);
  assert.deepEqual(floats(writes), [
    { offset: 64, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -4, 0, 0, 1] },
  ]);
  assert.equal(motion.moved, true);
  writes.length = 0;
  // The next frame, with no new motion: the entry returns to identity, and nothing else.
  motion.update([10, 20, 30], true);
  assert.deepEqual(floats(writes), [{ offset: 64, data: IDENTITY }]);
  assert.equal(motion.moved, false);
});

test('a moved rotation anchors on the eye: translation is R·eye + t − eye', () => {
  const { device, writes } = fakeDevice();
  const racine = { world: { elements: [...IDENTITY] } };
  const motion = createPlacementMotion(device, [racine]);
  writes.length = 0;
  // Quarter-turn rotation around z: (x, y) → (−y, x). Its inverse turns the other
  // way, and "previous" is identity, so M = R⁻¹.
  racine.world.elements = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  motion.update([2, 0, 0], true);
  const m = floats(writes)[0].data;
  // R⁻¹: (x, y) → (y, −x); column 0 = (0, −1, 0), column 1 = (1, 0, 0).
  assert.deepEqual(m.slice(0, 3), [0, -1, 0]);
  assert.deepEqual(m.slice(4, 7), [1, 0, 0]);
  // R⁻¹·eye − eye = (0, −2, 0) − (2, 0, 0) = (−2, −2, 0).
  assert.deepEqual(m.slice(12, 15), [-2, -2, 0]);
  assert.equal(m[15], 1);
  // Lost history resets everything to identity and takes current poses as reference.
  writes.length = 0;
  motion.reset();
  assert.deepEqual(floats(writes), [{ offset: 0, data: IDENTITY }]);
  writes.length = 0;
  motion.update([2, 0, 0], true);
  assert.equal(writes.length, 0, 'after the reset, the current pose does not count as motion');
});
