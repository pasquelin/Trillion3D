import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceMixers, animation, Mixer } from './index.ts';
import { object } from '../object/index.ts';
import { material } from '../material/index.ts';
import { geometry } from '../geometry/index.ts';
import { Object3D } from '../object/object3d.ts';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} ≠ ${expected}`);

/** A node named `arm` under a root, its rest pose set, and one clip per track kind. */
function rig() {
  const root = object.group();
  const arm = object.mesh(geometry.box(1, 1, 1), material.meshStandard({ color: 0x000000 }));
  arm.name = 'arm';
  arm.position.set(1, 2, 3);
  root.add(arm);
  const quarter = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  const clip = (name: string, x: number, turn: number[]) =>
    animation.clip(name, 1, [
      animation.vectorTrack('arm.position', [0, 1], [x, 0, 0, x, 0, 0]),
      animation.quaternionTrack('arm.quaternion', [0, 1], [...turn, ...turn]),
      animation.colorTrack('arm.material.color', [0, 1], [1, 1, 1, 1, 1, 1]),
      animation.numberTrack('arm.material.opacity', [0, 1], [0, 0]),
    ]);
  return { root, arm, walk: clip('walk', 5, quarter), wave: clip('wave', 3, [1, 0, 0, 0]) };
}
const mat = (arm: ReturnType<typeof rig>['arm']) =>
  arm.material as unknown as { color: { r: number }; opacity: number };

test('an action of weight 0 leaves the rest pose on every track kind', () => {
  const { root, arm, walk } = rig();
  const mixer = animation.createMixer(root);
  const action = mixer.clipAction(walk);
  action.weight = 0;
  action.play();
  const opacity = mat(arm).opacity;
  for (let i = 0; i < 10; i++) mixer.update(0.05);
  assert.deepEqual([arm.position.x, arm.position.y, arm.position.z], [1, 2, 3]);
  assert.deepEqual(
    [arm.quaternion.x, arm.quaternion.y, arm.quaternion.z, arm.quaternion.w],
    [0, 0, 0, 1],
  );
  assert.equal(mat(arm).color.r, 0);
  assert.equal(mat(arm).opacity, opacity);
});

test('an action of weight 1 writes its samples', () => {
  const { root, arm, walk } = rig();
  const mixer = animation.createMixer(root);
  mixer.clipAction(walk).play();
  mixer.update(0.1);
  assert.deepEqual([arm.position.x, arm.position.y, arm.position.z], [5, 0, 0]);
  close(arm.quaternion.y, Math.SQRT1_2);
  assert.equal(mat(arm).color.r, 1);
  assert.equal(mat(arm).opacity, 0);
});

test('two actions at 0.5 give the mean, and a rotation blend stays unit length', () => {
  const { root, arm, walk, wave } = rig();
  const mixer = animation.createMixer(root);
  for (const clip of [walk, wave]) Object.assign(mixer.clipAction(clip).play(), { weight: 0.5 });
  mixer.update(0.1);
  close(arm.position.x, 4);
  const { x, y, z, w } = arm.quaternion;
  close(Math.hypot(x, y, z, w), 1);
  // The normalised mean of a quarter turn about y and a half turn about x.
  close(x, Math.SQRT1_2);
  close(y, 0.5);
  close(w, 0.5);
  close(z, 0);
});

test('an action at 0.5 alone blends its sample with the rest pose', () => {
  const { root, arm, walk } = rig();
  const mixer = animation.createMixer(root);
  Object.assign(mixer.clipAction(walk).play(), { weight: 0.5 });
  mixer.update(0.1);
  assert.deepEqual([arm.position.x, arm.position.y, arm.position.z], [3, 1, 1.5]);
  close(mat(arm).color.r, 0.5);
});

test('the blend is the same at 30 and at 120 updates per second', () => {
  const moving = () =>
    animation.clip('sway', 2, [animation.vectorTrack('arm.position', [0, 2], [0, 0, 0, 8, 0, 0])]);
  const after = (rate: number) => {
    const { root, arm } = rig();
    const mixer = animation.createMixer(root);
    Object.assign(mixer.clipAction(moving()).play(), { weight: 0.25 });
    for (let i = 0; i < rate; i++) mixer.update(1 / rate);
    return arm.position.x;
  };
  close(after(30), after(120));
  close(after(120), 0.75 * 1 + 0.25 * 4);
});

test('a rotation and its opposite sign blend to that rotation, not to zero', () => {
  const { root, arm } = rig();
  const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  const turn = (name: string, v: number[]) =>
    animation.clip(name, 1, [animation.quaternionTrack('arm.quaternion', [0, 1], [...v, ...v])]);
  const mixer = animation.createMixer(root);
  Object.assign(mixer.clipAction(turn('a', q)).play(), { weight: 0.5 });
  Object.assign(
    mixer
      .clipAction(
        turn(
          'b',
          q.map((c) => -c),
        ),
      )
      .play(),
    { weight: 0.5 },
  );
  mixer.update(0.1);
  close(Math.abs(arm.quaternion.y), Math.SQRT1_2);
  close(Math.abs(arm.quaternion.w), Math.SQRT1_2);
  close(arm.quaternion.y * arm.quaternion.w, 0.5);
});

/** A mixer on `rig()` with one action sliding `arm` from x 0 to x 10 over one second. */
function slide() {
  const { root, arm } = rig();
  const clip = animation.clip('slide', 1, [
    animation.numberTrack('arm.position.x', [0, 1], [0, 10]),
  ]);
  return { root, arm, action: animation.createMixer(root).clipAction(clip) };
}

test('a seek poses a stopped action at once, and the loop leaves it there', () => {
  const { root, arm, action } = slide();
  action.seek(0.25);
  close(arm.position.x, 2.5);
  assert.equal(action.playingNow, false);
  assert.equal(advanceMixers(root, 0.5), false);
  close(arm.position.x, 2.5);
});

test('a seek on a playing action moves it, and playing goes on from there', () => {
  const { arm, action } = slide();
  action.play();
  action.mixer.update(0.1);
  action.seek(0.5);
  close(arm.position.x, 5);
  action.mixer.update(0.25);
  close(arm.position.x, 7.5);
});

test('a seek on a stopped action beside a playing one poses it once, never advancing it', () => {
  const { root, arm, action } = slide();
  const lift = animation.clip('lift', 1, [
    animation.numberTrack('arm.position.y', [0, 1], [0, 10]),
  ]);
  const other = action.mixer.clipAction(lift).play();
  action.mixer.update(0.1);
  action.seek(0.25);
  close(arm.position.x, 2.5);
  close(arm.position.y, 1);
  assert.equal(advanceMixers(root, 0.5), true);
  close(action.time, 0.25);
  close(other.time, 0.6);
  close(arm.position.x, 2.5);
  close(arm.position.y, 6);
});

test('a seek past the end follows the loop mode', () => {
  const { arm, action } = slide();
  const at = (loop: typeof action.loop, time: number) => {
    action.loop = loop;
    action.seek(time);
    return arm.position.x;
  };
  close(at('repeat', 1.25), 2.5);
  close(at('pingpong', 1.25), 7.5);
  close(at('once', 3), 10);
});

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

const ramp = (name = '.renderOrder', duration = 4) =>
  animation.clip('ramp', duration, [animation.numberTrack(name, [0, duration], [0, 40])]);

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
