import test from 'node:test';
import assert from 'node:assert/strict';
import { joint } from '../../../sdk-core/src/physics/index.ts';
import { WEAK, brokenPastForce, gap, jointRig, widestSwings } from './joints.fixture.ts';

test('fixed: two bodies fall as one; the world holds a body still; past its force it breaks', async () => {
  const rig = await jointRig();
  const [a, b] = [rig.cube(0, 5, 0), rig.cube(1.5, 5.5, 0)];
  const held = rig.cube(5, 2, 0);
  const weak = rig.cube(-5, 2, 0);
  const breaking = joint.fixed(weak, null, { breakForce: WEAK });
  let told = 0;
  breaking.on('break', () => told++);
  rig.wanted.add(joint.fixed(a, b)).add(joint.fixed(held, null)).add(breaking);
  rig.run(40);
  assert.ok(rig.at(a)[1] < 3, 'the pair falls');
  assert.ok(Math.abs(gap(rig.at(a), rig.at(b)) - Math.hypot(1.5, 0.5)) < 0.02, 'as one');
  assert.ok(gap(rig.at(held), [5, 2, 0]) < 0.02, 'the welded body stays');
  assert.ok(breaking.broken && told === 1, 'the weak weld broke, once');
  assert.ok(rig.at(weak)[1] < 1, 'and its body fell');
});

test('point: a pendulum swings about its pin, at its length', async () => {
  const rig = await jointRig();
  const bob = rig.cube(2, 4, 0);
  const snapped = rig.cube(-2, 4, 0);
  rig.wanted.add(joint.point(bob, null, { anchor: [0, 4, 0] }));
  const weak = joint.point(snapped, null, { anchor: [-4, 4, 0], breakForce: WEAK });
  rig.wanted.add(weak);
  rig.run(30);
  assert.ok(rig.at(bob)[1] < 3.5, 'it swings down');
  assert.ok(Math.abs(gap(rig.at(bob), [0, 4, 0]) - 2) < 0.03, 'at its length');
  assert.ok(weak.broken, 'the weak pin let go');
});

test('hinge: a door turns about its pin, driven by its motor, stopped by its limit', async () => {
  const rig = await jointRig([0, 0, 0]);
  const door = rig.cube(0.5, 1, 0);
  const stopped = rig.cube(0.5, 1, 5);
  const hinge = joint.hinge(door, null, {
    anchor: [0, 1, 0],
    motor: { mode: 'velocity', target: 1, maxForce: 1e5 },
  });
  const limited = joint.hinge(stopped, null, {
    anchor: [0, 1, 5],
    limits: { min: 0, max: 0.4 },
    motor: { mode: 'velocity', target: 2, maxForce: 1e5 },
  });
  rig.wanted.add(hinge).add(limited);
  rig.run(60);
  assert.ok(Math.abs(rig.yaw(door) - 1) < 0.1, `turned 1 rad in 1 s: ${rig.yaw(door)}`);
  assert.ok(Math.abs(gap(rig.at(door), [0, 1, 0]) - 0.5) < 0.02, 'about its pin');
  assert.ok(Math.abs(rig.yaw(stopped) - 0.4) < 0.05, `the limit stops it: ${rig.yaw(stopped)}`);
  hinge.motor = { mode: 'position', target: 0, maxForce: 1e5 };
  rig.run(120);
  assert.ok(Math.abs(rig.yaw(door)) < 0.05, 'the motor drives it back shut');
});

test('between two bodies, a motor drives `a` from `b` the way it drives it from the world', async () => {
  const rig = await jointRig([0, 0, 0]);
  const frame = rig.cube(-2, 1, 0, 'static');
  const door = rig.cube(0.5, 1, 0);
  const rail = rig.cube(-2, 1, 5, 'static');
  const drawer = rig.cube(0, 1, 5);
  const velocity = { mode: 'velocity', target: 1, maxForce: 1e5 } as const;
  rig.wanted.add(joint.hinge(door, frame, { anchor: [0, 1, 0], motor: velocity }));
  rig.wanted.add(joint.slider(drawer, rail, { axis: [1, 0, 0], motor: velocity }));
  rig.run(60);
  assert.ok(Math.abs(rig.yaw(door) - 1) < 0.1, `turned +1 rad about +y: ${rig.yaw(door)}`);
  assert.ok(Math.abs(rig.at(drawer)[0] - 1) < 0.05, `slid +1 m along +x: ${rig.at(drawer)[0]}`);
});

test('slider: a drawer slides on its rail by its motor, to its limit; past its force it breaks', async () => {
  const rig = await jointRig();
  const drawer = rig.cube(0, 1, 0);
  const stopped = rig.cube(0, 1, 5);
  const weak = rig.cube(0, 1, -5);
  const motor = { mode: 'velocity', target: 1, maxForce: 1e5 } as const;
  rig.wanted.add(joint.slider(drawer, null, { axis: [1, 0, 0], motor }));
  rig.wanted.add(joint.slider(stopped, null, { axis: [1, 0, 0], motor, limits: { max: 0.5 } }));
  rig.wanted.add(joint.slider(weak, null, { axis: [1, 0, 0], breakForce: WEAK }));
  rig.run(60);
  assert.ok(Math.abs(rig.at(drawer)[0] - 1) < 0.05, `slid 1 m in 1 s: ${rig.at(drawer)[0]}`);
  assert.ok(Math.abs(rig.at(drawer)[1] - 1) < 0.02, 'held on its rail against gravity');
  assert.ok(Math.abs(rig.at(stopped)[0] - 0.5) < 0.03, 'the limit stops it');
  assert.ok(rig.at(weak)[1] < 0, 'the weak rail let go');
});

test('distance: a rope keeps its length, a limit lets it hang slack, a spring lets it stretch', async () => {
  const rig = await jointRig();
  const [rod, rope, spring] = [0, 4, 8].map((x) => rig.cube(x, 0, 0));
  const top = (x: number) => ({ anchorB: [x, 2, 0] as const });
  rig.wanted.add(joint.distance(rod, null, top(0)));
  rig.wanted.add(joint.distance(rope, null, { ...top(4), limits: { max: 3 } }));
  rig.wanted.add(joint.distance(spring, null, { ...top(8), spring: { frequency: 1, damping: 0 } }));
  rig.run(30);
  assert.ok(Math.abs(rig.at(rod)[1]) < 0.02, 'the rod holds its length');
  assert.ok(
    Math.abs(rig.at(rope)[1] + 1) < 0.05,
    `the rope hangs at its limit: ${rig.at(rope)[1]}`,
  );
  assert.ok(rig.at(spring)[1] < -0.1, 'the spring stretches');
});

test('cone: a body on a ball joint swings no further than its cone', async () => {
  const rig = await jointRig();
  const [coned, free] = [0, 4].map((x) => rig.cube(x, 1, 0));
  rig.wanted.add(
    joint.cone(coned, null, { anchor: [0, 2, 0], axis: [0, -1, 0], limits: { max: 0.3 } }),
  );
  rig.wanted.add(joint.point(free, null, { anchor: [4, 2, 0] }));
  const [widest, freest] = widestSwings(rig, coned, free);
  assert.ok(widest < 0.35, `held in its cone: ${widest}`);
  assert.ok(freest > 0.5, `a ball joint alone swings further: ${freest}`);
});

test('a joint whose body leaves is taken out with it, and made again when it returns', async () => {
  const rig = await jointRig();
  const bob = rig.cube(0, 1, 0);
  rig.wanted.add(joint.fixed(bob, null));
  rig.run(10);
  rig.scene.remove(bob);
  rig.run(10);
  bob.position.set(0, 1, 0);
  rig.scene.add(bob);
  rig.run(30);
  assert.ok(gap(rig.at(bob), [0, 1, 0]) < 0.02, 'held again where it came back');
});

test('joint options a kind lacks are refused', () => {
  const [a, b] = [{}, {}] as never[];
  assert.throws(() => joint.fixed(a, b, { motor: { mode: 'velocity', target: 1 } }), RangeError);
  assert.throws(() => joint.cone(a, b, { spring: { frequency: 1 } }), RangeError);
  assert.throws(() => joint.point(a, a), RangeError);
  assert.throws(() => (joint.distance(a, b).motor = { mode: 'position', target: 0 }), RangeError);
});

test('every kind breaks when pulled past its force, and holds below it', async () => {
  const rig = await jointRig();
  const kinds = ['fixed', 'point', 'hinge', 'slider', 'distance', 'cone'] as const;
  const broken = brokenPastForce(rig, kinds, (_, x, z) => ({
    anchor: [x, 2, z] as const,
    axis: [1, 0, 0] as const,
  }));
  assert.deepEqual(
    broken,
    kinds.flatMap(() => [true, false]),
  );
});

test('breaking: a step visits the joints a finite force breaks, whatever the other joints', async () => {
  // Forty joints that never break (no force, or an infinite one), then one that can.
  const rig = await jointRig();
  const anchor = rig.cube(0, 1, 0);
  for (let i = 0; i < 40; i++)
    rig.wanted.add(joint.point(anchor, null, i % 2 ? { breakForce: Infinity } : {}));
  const perStep = () => {
    const before = rig.visits.break();
    rig.run(1);
    return rig.visits.break() - before;
  };
  assert.equal(perStep(), 0, 'forty unbreakable joints: no visit');
  const breakable = joint.point(anchor, null, { breakForce: 1e6 });
  rig.wanted.add(breakable);
  assert.equal(perStep(), 1, 'one breakable joint beside forty: one visit');
  rig.wanted.delete(breakable);
  assert.equal(perStep(), 0, 'the breakable joint taken out: no visit');
});
