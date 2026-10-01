import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceMixers, animation, Mixer } from './index.ts';
import { Object3D } from '../object/object3d.ts';

const ramp = (name = '.renderOrder', duration = 4) =>
  animation.clip('ramp', duration, [animation.numberTrack(name, [0, duration], [0, 40])]);

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

test('actions bind late targets once, reuse clip identity and keep the first reference pose', () => {
  const root = new Object3D();
  const mixer = new Mixer(root);
  const clip = ramp('late.renderOrder');
  const action = mixer.clipAction(clip);
  assert.equal(mixer.clipAction(clip), action);
  assert.notEqual(mixer.clipAction({ ...clip }), action);
  assert.equal(action.bindingOf(clip.tracks[0]), null);
  action.play();
  assert.equal(mixer.update(0.5), true);
  const child = new Object3D();
  child.name = 'late';
  root.add(child);
  const binding = action.bindingOf(clip.tracks[0]);
  assert.ok(binding);
  assert.equal(binding.owner, child);
  assert.equal(binding.field, 'renderOrder');
  assert.equal(action.bindingOf(clip.tracks[0]), binding);
  mixer.update(0.5);
  assert.equal(child.renderOrder, 10);
  assert.deepEqual(Array.from(binding.reference!), [0]);
  assert.deepEqual(Array.from(binding.value), [10]);
  mixer.stopAll();
});

test('once actions apply their endpoint exactly, timeScale changes speed and stop resets time', () => {
  const root = new Object3D();
  const mixer = new Mixer(root);
  const action = mixer.play(ramp());
  action.loop = 'once';
  action.timeScale = 2;
  assert.equal(mixer.update(0.5), true);
  assert.equal(root.renderOrder, 10);
  assert.equal(action.time, 1);
  assert.equal(mixer.update(1.5), false);
  assert.equal(root.renderOrder, 40);
  assert.equal(action.playingNow, false);
  assert.equal(mixer.update(1), false);
  assert.equal(root.renderOrder, 40);
  let visits = 0;
  const update = mixer.update.bind(mixer);
  mixer.update = (seconds) => {
    visits++;
    return update(seconds);
  };
  assert.equal(advanceMixers(root, 1), false);
  assert.equal(visits, 0, 'a completed mixer leaves the world scheduler');
  assert.equal(action.stop(), action);
  assert.equal(action.time, 0);
  assert.equal(action.seek(2), action);
  assert.equal(root.renderOrder, 20);
  assert.equal(action.playingNow, false);
  mixer.stopAll();
});

test('nonunit clip durations wrap backwards and pingpong across both turning points', () => {
  const mixer = new Mixer(new Object3D());
  const action = mixer.clipAction(ramp('.renderOrder', 3));
  action.time = 4;
  assert.equal(action.clipTime(), 1);
  action.time = -1;
  assert.equal(action.clipTime(), 2);
  action.loop = 'pingpong';
  for (const [time, expected] of [
    [-1, 1],
    [0, 0],
    [3, 3],
    [4, 2],
    [5, 1],
    [6, 0],
    [7, 1],
    [11, 1],
    [12, 0],
  ]) {
    action.time = time;
    assert.equal(action.clipTime(), expected);
  }
  action.loop = 'once';
  action.time = 1;
  assert.equal(action.clipTime(), 1);
  action.time = 4;
  assert.equal(action.clipTime(), 3);
});

test('world advancement visits nested mixers only and stopAll removes every playing action', () => {
  const scene = new Object3D(),
    branch = new Object3D(),
    root = new Object3D(),
    other = new Object3D();
  scene.add(branch);
  branch.add(root);
  const mixer = new Mixer(root),
    detached = new Mixer(other);
  const first = mixer.play(ramp()),
    second = mixer.play(ramp('.userData.opacity'));
  root.userData.opacity = 0;
  const outside = detached.play(ramp());
  let visits = 0;
  const update = mixer.update.bind(mixer);
  mixer.update = (seconds) => {
    visits++;
    return update(seconds);
  };
  try {
    assert.equal(advanceMixers(scene, 1), true);
    assert.equal(root.renderOrder, 10);
    assert.equal(other.renderOrder, 0);
    assert.equal(outside.time, 0);
    mixer.stopAll();
    assert.equal(first.playingNow, false);
    assert.equal(second.playingNow, false);
    assert.equal(first.time, 0);
    assert.equal(second.time, 0);
    assert.equal(advanceMixers(scene, 1), false);
    assert.equal(root.renderOrder, 10);
    assert.equal(visits, 1, 'stopped mixers are no longer scheduled');
  } finally {
    mixer.stopAll();
    detached.stopAll();
  }
});

test('an additive clip measures motion from its first key even when the clip has preroll', () => {
  const root = new Object3D();
  root.renderOrder = 5;
  const mixer = new Mixer(root);
  const clip = animation.clip('preroll', 2, [
    animation.numberTrack('.renderOrder', [-1, 1], [10, 30]),
  ]);
  const action = mixer.play(clip);
  action.blendMode = 'additive';
  action.seek(0);
  assert.equal(root.renderOrder, 15);
  assert.deepEqual(Array.from(action.bindingOf(clip.tracks[0])!.reference!), [10]);
  mixer.stopAll();
});
