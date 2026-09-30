import assert from 'node:assert/strict';
import test from 'node:test';
import { animation, Mixer } from './index.ts';
import { Object3D } from '../object/object3d.ts';

test('many additive actions retain a quarter turn after their complete revolutions', () => {
  const root = new Object3D();
  const mixer = new Mixer(root);
  // 2201 quarter turns contain 550 complete revolutions and one quarter turn.
  // This also exercises enough partial turns to expose lost numeric scale.
  for (let i = 0; i < 2201; i++) {
    const track = animation.quaternionTrack('.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 1, 0]);
    const action = mixer.play(animation.clip(`turn-${i}`, 1, [track]));
    action.loop = 'once';
    action.blendMode = 'additive';
    action.weight = 0.5;
  }
  try {
    assert.equal(mixer.update(1), false);
    const { x, y, z, w } = root.quaternion;
    assert.ok(Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12);
    assert.ok(Math.abs(Math.abs(z) - Math.SQRT1_2) < 1e-12);
    assert.ok(Math.abs(z * w - 0.5) < 1e-12);
  } finally {
    mixer.stopAll();
  }
});
