import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../world/object/object3d.ts';
import { joint, Joint, type JointKind, type JointOptions } from './joint.ts';

test('a newly created joint has no simulation slot', () => {
  assert.equal(joint.fixed(new Object3D(), null)._id, -1);
});

const allowed: Record<JointKind, string[]> = {
  fixed: [],
  point: [],
  hinge: ['limits', 'spring', 'motor'],
  slider: ['limits', 'spring', 'motor'],
  distance: ['limits', 'spring'],
  cone: ['limits'],
  swingTwist: ['limits', 'motor'],
  sixDof: ['axes', 'spring', 'motor'],
  path: ['path', 'loop', 'follow', 'motor'],
  pulley: ['over', 'ratio', 'limits'],
  gear: ['axisB', 'ratio'],
  rackAndPinion: ['axisB', 'ratio'],
};
const tuning = {
  limits: { min: -1, max: 2 },
  spring: { frequency: 3 },
  motor: { mode: 'velocity', target: 4 },
  axes: { x: 'free' },
  axisB: [1, 0, 0],
  path: [
    [0, 0, 0],
    [1, 2, 3],
  ],
  loop: false,
  follow: false,
  over: [
    [0, 2, 0],
    [1, 2, 0],
  ],
  ratio: 2,
};
const required = (kind: JointKind): JointOptions =>
  kind === 'path'
    ? {
        path: [
          [0, 0, 0],
          [1, 2, 3],
        ],
      }
    : kind === 'pulley'
      ? {
          over: [
            [0, 2, 0],
            [1, 2, 0],
          ],
        }
      : {};

test('joint factories retain their bodies and refuse incompatible physical tuning', () => {
  const a = new Object3D(),
    b = new Object3D();
  for (const kind of Object.keys(allowed) as JointKind[]) {
    const options = required(kind);
    const value = joint[kind](a, b, options);
    assert.equal(value.kind, kind);
    assert.equal(value.a, a);
    assert.equal(value.b, b);
    assert.equal(value.options, options);
    assert.equal(value.motor, null);
    assert.throws(() => joint[kind](a, a, options), /different bodies/);
    for (const [key, setting] of Object.entries(tuning)) {
      const make = () => joint[kind](a, b, { ...options, [key]: setting } as JointOptions);
      if (allowed[kind].includes(key)) assert.doesNotThrow(make, `${kind}: ${key}`);
      else
        assert.throws(
          make,
          (error) =>
            error instanceof RangeError &&
            error.message.includes(kind) &&
            error.message.includes(key),
          `${kind}: ${key}`,
        );
    }
  }
});

test('body, track and pulley requirements reject incomplete joints', () => {
  const a = new Object3D(),
    b = new Object3D();
  for (const kind of ['pulley', 'gear', 'rackAndPinion'] as const)
    assert.throws(() => joint[kind](a, null, required(kind)), /two bodies/);
  for (const path of [undefined, [], [[0, 0, 0]]])
    assert.throws(() => joint.path(a, null, { path } as JointOptions), /two points/);
  assert.doesNotThrow(() => joint.path(a, null, required('path')));
  assert.throws(() => joint.pulley(a, b), /wheels/);
  assert.equal(joint.fixed(a, null).b, null);
});

test('motor writes reach the host and breaks notify each subscribed handler once', () => {
  const value = joint.hinge(new Object3D(), null);
  const calls: Joint[] = [];
  value._host = { motor: (item) => calls.push(item) };
  const motor = { mode: 'position', target: 2 } as const;
  value.motor = motor;
  assert.equal(value.motor, motor);
  value.motor = null;
  assert.equal(value.motor, null);
  assert.deepEqual(calls, [value, value]);
  const initial = joint.slider(new Object3D(), null, { motor });
  assert.equal(initial.motor, motor);
  const fixed = joint.fixed(new Object3D(), null);
  assert.throws(() => {
    fixed.motor = motor;
  }, /motor/);
  fixed.motor = null;
  let first = 0,
    second = 0;
  const unsubscribe = value.on('break', () => first++);
  value.on('break', () => second++);
  unsubscribe();
  assert.equal(value.broken, false);
  value._break();
  value._break();
  assert.equal(value.broken, true);
  assert.deepEqual([first, second], [0, 1]);
});
