import test from 'node:test';
import assert from 'node:assert/strict';
import { joint, type JointOptions } from '../../../sdk-core/src/physics/index.ts';
import { WEAK, circle, jointRig } from './joints.fixture.ts';
const strong = (mode: 'velocity' | 'position', target: number) => ({ mode, target, maxForce: 1e6 });

test('sixDof spring: a slide past its limit springs back, a hard limit holds', async () => {
  const rig = await jointRig([0, 0, 0]);
  const [sprung, hard] = [0, 4].map((x) => rig.cube(x, 0, 0));
  const axes = { x: { min: 0, max: 0.5 } };
  rig.wanted.add(joint.sixDof(sprung, null, { axes, spring: { frequency: 2, damping: 0.2 } }));
  rig.wanted.add(joint.sixDof(hard, null, { axes }));
  rig.run(1);
  for (const cube of [sprung, hard]) rig.writer.velocity(cube.physics!._index, [3, 0, 0]);
  let [furthest, hardest] = [0, 0];
  for (let s = 0; s < 120; s++) {
    rig.run(1);
    furthest = Math.max(furthest, rig.at(sprung)[0]);
    hardest = Math.max(hardest, rig.at(hard)[0] - 4);
  }
  assert.ok(furthest > 0.6, `the spring lets it pass its limit: ${furthest}`);
  assert.ok(rig.at(sprung)[0] < furthest - 0.1, `and pulls it back: ${rig.at(sprung)[0]}`);
  assert.ok(hardest < 0.55, `a hard limit holds: ${hardest}`);
});

test('pulley ratio and limits: b moves ratio times as far as a; the rope stops at its lengths', async () => {
  const rig = await jointRig([0, 0, 0]);
  const pair = (z: number, options: JointOptions, speed: [number, number]) => {
    const [a, b] = [rig.cube(0, 0, z), rig.cube(4, 0, z)];
    const over = [[0, 3, z] as const, [4, 3, z] as const] as const;
    rig.wanted.add(joint.pulley(a, b, { over, ...options }));
    return { a, b, speed };
  };
  // Each rope 3 m: 6 m at ratio 1, 3 + 2 × 3 = 9 m at ratio 2.
  const geared = pair(0, { ratio: 2 }, [-1, 0]);
  const longest = pair(8, { limits: { max: 7 } }, [-1, -1]);
  const shortest = pair(16, { limits: { min: 5, max: 6 } }, [1, 1]);
  rig.run(1);
  for (const { a, b, speed } of [geared, longest, shortest]) {
    rig.writer.velocity(a.physics!._index, [0, speed[0], 0]);
    rig.writer.velocity(b.physics!._index, [0, speed[1], 0]);
  }
  rig.run(60);
  const y = (cube: typeof geared.a) => rig.at(cube)[1];
  assert.ok(y(geared.a) < -0.1, `a fell: ${y(geared.a)}`);
  assert.ok(Math.abs(y(geared.b) + 2 * y(geared.a)) < 0.05, `b rose twice as far: ${y(geared.b)}`);
  for (const cube of [longest.a, longest.b])
    assert.ok(Math.abs(y(cube) + 0.5) < 0.03, `the 7 m rope stops each 0.5 m down: ${y(cube)}`);
  for (const cube of [shortest.a, shortest.b])
    assert.ok(Math.abs(y(cube) - 0.5) < 0.03, `the 5 m rope stops each 0.5 m up: ${y(cube)}`);
});

test('path follow: a following cart turns with its track, a free one keeps its turn', async () => {
  const rig = await jointRig([0, 0, 0]);
  // The same circle twice, 4 m apart in height so the two cubes never meet.
  const ride = (y: number, follow: boolean) => ({
    path: circle(y),
    loop: true,
    follow,
    motor: strong('velocity', 2),
  });
  const [cart, bead] = [rig.cube(3, 0, 0), rig.cube(3, 4, 0)];
  rig.wanted.add(joint.path(cart, null, ride(0, true)));
  rig.wanted.add(joint.path(bead, null, ride(4, false)));
  rig.run(60);
  // 2 m along a 3 m circle: the track turned 2/3 rad.
  const swept = Math.abs(Math.atan2(rig.at(cart)[2], rig.at(cart)[0]));
  assert.ok(Math.abs(swept - 2 / 3) < 0.1, `the cart went round: ${swept}`);
  assert.ok(Math.abs(Math.abs(rig.yaw(cart)) - swept) < 0.05, `and turned: ${rig.yaw(cart)}`);
  assert.ok(Math.abs(rig.yaw(bead)) < 0.02, `the free one kept its turn: ${rig.yaw(bead)}`);
});

test('gear and rack and pinion break past their torque, and hold below it', async () => {
  const rig = await jointRig([0, 0, 0]);
  // A driver at full torque against a braked wheel or rack: 5e4 N·m between the teeth.
  const drive = strong('velocity', 4);
  const brake = { mode: 'velocity' as const, target: 0, maxForce: 5e4 };
  const made = [WEAK, 1e6].flatMap((breakForce, k) => {
    const z = k * 4;
    const [driver, driven, pinion, rack] = [0, 3, 6, 9].map((x) => rig.cube(x, 0, z));
    const rail = [1, 0, 0] as const;
    rig.wanted.add(joint.hinge(driver, null, { motor: drive }));
    rig.wanted.add(joint.hinge(driven, null, { motor: brake }));
    rig.wanted.add(joint.hinge(pinion, null, { motor: drive }));
    rig.wanted.add(joint.slider(rack, null, { axis: rail, motor: brake }));
    return [
      joint.gear(driver, driven, { ratio: 2, breakForce }),
      joint.rackAndPinion(pinion, rack, { axisB: rail, ratio: 2, breakForce }),
    ];
  });
  for (const j of made) rig.wanted.add(j);
  rig.run(20);
  assert.deepEqual(
    made.map((j) => j.broken),
    [true, true, false, false],
  );
});
