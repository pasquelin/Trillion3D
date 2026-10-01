import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../world/object/object3d.ts';
import { joint, Joint, type JointKind, type JointOptions } from './joint.ts';

const limits = { min: -1, max: 2 };
const spring = { frequency: 3 };
const motor = { mode: 'velocity', target: 4 } as const;
const track = [
  [0, 0, 0],
  [1, 2, 3],
] as const;
const wheels = [
  [0, 2, 0],
  [1, 2, 0],
] as const;

/** Each kind made with every tuning its documentation (`joint.ts`, `JointOptions`) gives it. */
const tuned: Record<JointKind, JointOptions> = {
  fixed: {},
  point: {},
  hinge: { limits, spring, motor },
  slider: { limits, spring, motor },
  distance: { limits, spring },
  cone: { limits },
  swingTwist: { limits, motor },
  sixDof: { axes: { x: 'free', turnY: limits }, spring, motor: { ...motor, axis: 'turnY' } },
  path: { path: track, loop: false, follow: false, motor },
  pulley: { over: wheels, ratio: 2, limits },
  gear: { axisB: [1, 0, 0], ratio: 2 },
  rackAndPinion: { axisB: [1, 0, 0], ratio: 2 },
};
const kinds = Object.keys(tuned) as JointKind[];
/** Asserts `make` throws a `RangeError` that says why, naming `kind` when given. */
function refusedWhy(make: () => unknown, kind = '') {
  assert.throws(make, (error: unknown) => {
    assert.ok(error instanceof RangeError);
    assert.ok(error.message.length > kind.length && error.message.includes(kind), error.message);
    return true;
  });
}
/** What a kind cannot be made without (`JointOptions`): a path's track, a pulley's wheels. */
const needed = (kind: JointKind): JointOptions =>
  kind === 'path' ? { path: track } : kind === 'pulley' ? { over: wheels } : {};

test('a joint holds its bodies, kind and options, and no simulation slot until added', () => {
  const a = new Object3D(),
    b = new Object3D();
  for (const kind of kinds) {
    const made = joint[kind](a, b, tuned[kind]);
    assert.ok(made instanceof Joint);
    assert.deepEqual([made.kind, made.a, made.b, made.options], [kind, a, b, tuned[kind]]);
    assert.equal(made._id, -1);
    assert.equal(made.broken, false);
    assert.equal(made.motor, tuned[kind].motor ?? null);
  }
  assert.equal(joint.fixed(a, null).b, null, 'a body and the world');
});

test('each kind takes the tunings it reads and refuses, by name, one it would ignore', () => {
  const a = new Object3D(),
    b = new Object3D();
  const every = Object.assign({}, ...Object.values(tuned)) as JointOptions;
  for (const kind of kinds)
    for (const [key, value] of Object.entries(every)) {
      const make = () => joint[kind](a, b, { ...needed(kind), [key]: value });
      if (key in tuned[kind]) assert.doesNotThrow(make, `${kind}: ${key}`);
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
  // A tuning left null or undefined is no tuning.
  assert.doesNotThrow(() => joint.fixed(a, b, { limits: undefined, motor: null }));
});

test('a joint needs two different bodies, and the track or wheels its kind cannot do without', () => {
  const a = new Object3D(),
    b = new Object3D();
  for (const kind of kinds) refusedWhy(() => joint[kind](a, a, tuned[kind]));
  for (const kind of ['pulley', 'gear', 'rackAndPinion'] as const) {
    refusedWhy(() => joint[kind](a, null, tuned[kind]), kind);
    assert.doesNotThrow(() => joint[kind](a, b, needed(kind)));
  }
  for (const path of [undefined, [], [track[0]]])
    refusedWhy(() => joint.path(a, null, { path }), 'path');
  assert.doesNotThrow(() => joint.path(a, null, { path: track }), 'a path to the world');
  refusedWhy(() => joint.pulley(a, b), 'pulley');
});

test('a motor written reaches the host; a kind without one refuses it', () => {
  const hinge = joint.hinge(new Object3D(), null);
  const heard: Joint[] = [];
  hinge._host = { motor: (item) => heard.push(item) };
  hinge.motor = motor;
  assert.equal(hinge.motor, motor);
  hinge.motor = null;
  assert.equal(hinge.motor, null);
  assert.deepEqual(heard, [hinge, hinge]);
  const fixed = joint.fixed(new Object3D(), null);
  assert.throws(() => {
    fixed.motor = motor;
  }, RangeError);
  assert.equal(fixed.motor, null);
  fixed.motor = null;
  assert.equal(fixed.motor, null, 'taking off a motor it never had');
});

test('a joint breaks once, telling each handler still subscribed', () => {
  const made = joint.hinge(new Object3D(), null);
  let first = 0,
    second = 0;
  const off = made.on('break', () => first++);
  made.on('break', () => second++);
  off();
  made._break();
  made._break();
  assert.equal(made.broken, true);
  assert.deepEqual([first, second], [0, 1]);
});
