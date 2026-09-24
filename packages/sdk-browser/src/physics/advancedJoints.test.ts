import test from 'node:test';
import assert from 'node:assert/strict';
import { joint } from '../../../sdk-core/src/physics/index.ts';
import { gap, jointRig } from './joints.fixture.ts';

/** A pull no joint below holds: a 1000 kg cube weighs about 9810 N. */
const WEAK = 500;
const strong = (mode: 'velocity' | 'position', target: number) => ({ mode, target, maxForce: 1e6 });

test('swingTwist: its axis swings within its cone, its motor twists it, stopped by its limit', async () => {
  const rig = await jointRig();
  const [coned, free] = [0, 4].map((x) => rig.cube(x, 1, 0));
  const hang = (x: number) => ({ anchor: [x, 2, 0] as const, axis: [0, -1, 0] as const });
  rig.wanted.add(joint.swingTwist(coned, null, { ...hang(0), limits: { swing: 0.3 } }));
  rig.wanted.add(joint.swingTwist(free, null, hang(4)));
  rig.run(1);
  rig.writer.velocity(coned.physics!._index, [4, 0, 0]);
  rig.writer.velocity(free.physics!._index, [4, 0, 0]);
  let widest = 0,
    freest = 0;
  for (let s = 0; s < 40; s++) {
    rig.run(1);
    const swing = (p: number[], x: number) => Math.atan2(Math.abs(p[0] - x), 2 - p[1]);
    widest = Math.max(widest, swing(rig.at(coned), 0));
    freest = Math.max(freest, swing(rig.at(free), 4));
  }
  assert.ok(widest < 0.35, `held in its cone: ${widest}`);
  assert.ok(freest > 0.5, `with no swing limit it swings further: ${freest}`);

  const still = await jointRig([0, 0, 0]);
  const [twisted, stopped] = [0, 4].map((x) => still.cube(x, 0, 0));
  const at = (x: number) => ({ anchor: [x, 0, 0] as const });
  still.wanted.add(joint.swingTwist(twisted, null, { ...at(0), motor: strong('velocity', 1) }));
  const limits = { min: -0.4, max: 0.4 };
  still.wanted.add(
    joint.swingTwist(stopped, null, { ...at(4), limits, motor: strong('velocity', 2) }),
  );
  still.run(60);
  assert.ok(Math.abs(still.yaw(twisted) - 1) < 0.1, `twisted 1 rad in 1 s: ${still.yaw(twisted)}`);
  assert.ok(gap(still.at(twisted), [0, 0, 0]) < 0.02, 'about its anchor');
  assert.ok(Math.abs(still.yaw(stopped) - 0.4) < 0.05, `the limit stops it: ${still.yaw(stopped)}`);
});

test('sixDof: a locked axis holds, a limited one stops its motor, a free turn follows its motor', async () => {
  const rig = await jointRig([0, 0, 0]);
  const slid = rig.cube(0, 0, 0);
  const turned = rig.cube(4, 0, 0);
  const slide = joint.sixDof(slid, null, {
    axes: { x: { min: 0, max: 0.5 } },
    motor: strong('velocity', 1),
  });
  const turn = joint.sixDof(turned, null, {
    axes: { turnY: 'free' },
    motor: { ...strong('velocity', 1), axis: 'turnY' },
  });
  rig.wanted.add(slide).add(turn);
  rig.run(1);
  rig.writer.velocity(slid.physics!._index, [0, 3, 3]);
  rig.writer.velocity(turned.physics!._index, [3, 3, 0]);
  rig.run(59);
  assert.ok(Math.abs(rig.at(slid)[0] - 0.5) < 0.03, `slid to its limit: ${rig.at(slid)[0]}`);
  assert.ok(Math.hypot(rig.at(slid)[1], rig.at(slid)[2]) < 0.02, 'its locked axes held');
  assert.ok(Math.abs(rig.yaw(slid)) < 0.02, 'and its locked turns');
  assert.ok(Math.abs(rig.yaw(turned) - 1) < 0.1, `turned 1 rad in 1 s: ${rig.yaw(turned)}`);
  assert.ok(gap(rig.at(turned), [4, 0, 0]) < 0.02, 'in place');
  slide.motor = strong('position', 0.2);
  rig.run(120);
  assert.ok(Math.abs(rig.at(slid)[0] - 0.2) < 0.03, `driven back to 0.2 m: ${rig.at(slid)[0]}`);
});

test('path: a cart held on its looped track against gravity, driven along it and to a point', async () => {
  const rig = await jointRig();
  const track = Array.from({ length: 12 }, (_, i) => {
    const angle = (2 * Math.PI * i) / 12;
    return [3 * Math.cos(angle), 0, 3 * Math.sin(angle)] as const;
  });
  const cart = rig.cube(3, 0, 0);
  const ride = joint.path(cart, null, { path: track, loop: true, motor: strong('velocity', 2) });
  rig.wanted.add(ride);
  rig.run(60);
  const p = rig.at(cart);
  assert.ok(Math.abs(Math.hypot(p[0], p[2]) - 3) < 0.05, `on its track: ${p}`);
  assert.ok(Math.abs(p[1]) < 0.05, `held against gravity: ${p[1]}`);
  const travelled = Math.abs(Math.atan2(p[2], p[0])) * 3;
  assert.ok(Math.abs(travelled - 2) < 0.2, `2 m along it in 1 s: ${travelled}`);
  ride.motor = strong('position', 3);
  rig.run(240);
  assert.ok(gap(rig.at(cart), track[3]) < 0.1, `driven to its fourth point: ${rig.at(cart)}`);
});

test('pulley: one load rises as the other falls, the rope keeps its length; past its force it breaks', async () => {
  const rig = await jointRig();
  const [a, b] = [rig.cube(0, 0, 0), rig.cube(4, 0, 0)];
  const [weakA, weakB] = [rig.cube(0, 0, 8), rig.cube(4, 0, 8)];
  const over = (z: number) => [[0, 3, z] as const, [4, 3, z] as const] as const;
  rig.wanted.add(joint.pulley(a, b, { over: over(0) }));
  const snapped = joint.pulley(weakA, weakB, { over: over(8), breakForce: WEAK });
  rig.wanted.add(snapped);
  rig.run(30);
  assert.ok(
    Math.abs(rig.at(a)[1]) < 0.02 && Math.abs(rig.at(b)[1]) < 0.02,
    'the rope carries both',
  );
  rig.writer.velocity(a.physics!._index, [0, -2, 0]);
  rig.run(20);
  assert.ok(rig.at(b)[1] > 0.2, `b rises as a falls: ${rig.at(b)[1]}`);
  assert.ok(Math.abs(rig.at(a)[1] + rig.at(b)[1]) < 0.05, 'the rope keeps its length');
  assert.ok(snapped.broken && rig.at(weakA)[1] < -1, 'the weak rope snapped and let go');
});

test('gear: two hinged wheels turn together by their ratio, the other way round', async () => {
  const rig = await jointRig([0, 0, 0]);
  const [a, b] = [rig.cube(0, 0, 0), rig.cube(3, 0, 0)];
  rig.wanted.add(joint.hinge(a, null, { motor: strong('velocity', 1) }));
  rig.wanted.add(joint.hinge(b, null));
  rig.wanted.add(joint.gear(a, b, { ratio: 2 }));
  rig.run(60);
  assert.ok(Math.abs(rig.yaw(a) - 1) < 0.1, `the driver turned 1 rad: ${rig.yaw(a)}`);
  assert.ok(Math.abs(rig.yaw(b) + 2) < 0.1, `the driven wheel turned −2 rad: ${rig.yaw(b)}`);
});

test('rackAndPinion: a turning pinion drives its rack along its rail by its ratio', async () => {
  const rig = await jointRig([0, 0, 0]);
  const [pinion, rack] = [rig.cube(0, 0, 0), rig.cube(1.5, 0, 0)];
  const [pin, rail] = [[0, 0, 1] as const, [0, 1, 0] as const];
  rig.wanted.add(joint.hinge(pinion, null, { axis: pin, motor: strong('velocity', 1) }));
  rig.wanted.add(joint.slider(rack, null, { axis: rail }));
  rig.wanted.add(joint.rackAndPinion(pinion, rack, { axis: pin, axisB: rail, ratio: 2 }));
  rig.run(60);
  assert.ok(Math.abs(rig.at(rack)[1] - 0.5) < 0.05, `1 rad at 2 rad/m: 0.5 m: ${rig.at(rack)[1]}`);
  assert.ok(Math.abs(rig.at(rack)[0] - 1.5) < 0.02, 'on its rail');
});

test('the advanced kinds break when pulled past their force, and hold below it', async () => {
  const rig = await jointRig();
  const kinds = ['swingTwist', 'sixDof', 'path'] as const;
  const made = kinds.flatMap((kind, i) =>
    [WEAK, 1e6].map((breakForce, k) => {
      const [x, z] = [i * 3, k * 3];
      const cube = rig.cube(x, 1, z);
      const path = [[x - 1, 1, z] as const, [x + 1, 1, z] as const];
      const options = kind === 'path' ? { path } : { anchor: [x, 2, z] as const };
      const made = joint[kind](cube, null, { ...options, breakForce });
      rig.wanted.add(made);
      return made;
    }),
  );
  rig.run(20);
  assert.deepEqual(
    made.map((j) => j.broken),
    kinds.flatMap(() => [true, false]),
  );
});

test('advanced joint options a kind lacks, or needs, are refused', () => {
  const [a, b] = [{}, {}] as never[];
  assert.throws(() => joint.hinge(a, b, { ratio: 2 }), RangeError);
  assert.throws(() => joint.gear(a, b, { motor: strong('velocity', 1) }), RangeError);
  assert.throws(() => joint.swingTwist(a, b, { spring: { frequency: 1 } }), RangeError);
  assert.throws(() => joint.cone(a, b, { axes: { x: 'free' } }), RangeError);
  assert.throws(() => joint.gear(a, null), RangeError);
  assert.throws(() => joint.path(a, null, { path: [[0, 0, 0]] }), RangeError);
  assert.throws(() => joint.pulley(a, b), RangeError);
  assert.doesNotThrow(() =>
    joint.sixDof(a, b, { axes: { turnZ: 'free' }, spring: { frequency: 2 } }),
  );
});
