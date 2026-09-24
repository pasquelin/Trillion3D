import test from 'node:test';
import assert from 'node:assert/strict';
import { animation } from './index.ts';
import { object } from '../object/index.ts';
import { material } from '../material/index.ts';
import { geometry } from '../geometry/index.ts';

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
