import test from 'node:test';
import assert from 'node:assert/strict';
import { joint } from '../../../sdk-core/src/physics/index.ts';
import { jointRig } from './joints.fixture.ts';

/** A body's turn about y since the first call, unwrapped step by step. */
function turnOf(rig: Awaited<ReturnType<typeof jointRig>>, mesh: Parameters<typeof rig.yaw>[0]) {
  let last = 0,
    total = 0;
  return () => {
    const step = rig.yaw(mesh) - last;
    total += step - 2 * Math.PI * Math.round(step / (2 * Math.PI));
    last += step;
    return total;
  };
}

test('gear and rack and pinion: a braked train keeps its teeth in phase over 10,000 steps', async () => {
  const rig = await jointRig([0, 0, 0]);
  // Wheels of 36, 12, 24 and 12 teeth, the last braked; the 12 → 24 gear written `a` small, so
  // its ratio is 0.5 and Jolt makes it the other way round. A 12-tooth pinion pushes a braked rack.
  const teeth = [36, 12, 24, 12];
  const wheels = teeth.map((_, i) => rig.cube(i * 3, 0, 0));
  const [pinion, rack] = [rig.cube(0, 0, 4), rig.cube(3, 0, 4)];
  const brake = { mode: 'velocity' as const, target: 0, maxForce: 5e4 };
  const drive = { mode: 'velocity' as const, target: 4, maxForce: 1e6 };
  wheels.forEach((wheel, i) =>
    rig.wanted.add(joint.hinge(wheel, null, { motor: i === 0 ? drive : i === 3 ? brake : null })),
  );
  const ratios = teeth.slice(1).map((n, i) => teeth[i] / n);
  ratios.forEach((ratio, i) => rig.wanted.add(joint.gear(wheels[i], wheels[i + 1], { ratio })));
  const rail = [1, 0, 0] as const;
  rig.wanted.add(joint.hinge(pinion, null, { motor: drive }));
  rig.wanted.add(joint.slider(rack, null, { axis: rail, motor: brake }));
  rig.wanted.add(joint.rackAndPinion(pinion, rack, { axisB: rail, ratio: 2 }));
  const turns = [...wheels, pinion].map((body) => turnOf(rig, body));
  // Each error in the driven wheel's radians, against a hundredth of its tooth pitch; the first
  // second, while the motor starts the train, left to the correction.
  const pitch = (n: number) => (2 * Math.PI) / n;
  const tolerances = [...teeth.slice(1).map(pitch), pitch(12)].map((p) => p / 100);
  const worst = tolerances.map(() => 0);
  for (let s = 0; s < 10_000; s++) {
    rig.run(1);
    const turned = turns.map((turn) => turn());
    const slide = rig.at(rack)[0] - 3;
    const errors = [...ratios.map((r, i) => turned[i + 1] + r * turned[i]), turned[4] - 2 * slide];
    if (s >= 60) errors.forEach((e, i) => (worst[i] = Math.max(worst[i], Math.abs(e))));
  }
  assert.ok(Math.abs(turns[0]() - 4 * (10_000 / 60)) < 1, 'the driver turned at its speed');
  worst.forEach((w, i) =>
    assert.ok(w < tolerances[i], `pair ${i} in phase: ${w} < ${tolerances[i]}`),
  );
});

test('gear linking: a joint costs the same link work whatever the other joints', async () => {
  // Three gears between hinged wheels, then `plain` point joints; the link work of those joints,
  // and of one more hinge on a geared wheel.
  async function work(plain: number) {
    const rig = await jointRig([0, 0, 0]);
    const wheels = [0, 1, 2, 3, 4, 5].map((i) => rig.cube(i * 3, 0, 0));
    wheels.forEach((wheel) => rig.wanted.add(joint.hinge(wheel, null)));
    [0, 2, 4].forEach((i) => rig.wanted.add(joint.gear(wheels[i], wheels[i + 1], { ratio: 2 })));
    rig.run(1);
    const anchor = rig.cube(0, 0, 6);
    const before = rig.linkVisits();
    for (let i = 0; i < plain; i++) rig.wanted.add(joint.point(anchor, null));
    rig.run(1);
    const plainWork = rig.linkVisits() - before;
    rig.wanted.add(joint.hinge(wheels[0], null));
    rig.run(1);
    return { plainWork, hingeWork: rig.linkVisits() - before - plainWork };
  }
  const [few, many] = [await work(4), await work(40)];
  assert.equal(few.plainWork, 0, 'a plain joint links no gear');
  assert.equal(many.plainWork, 0, 'forty plain joints link no gear');
  assert.ok(few.hingeWork > 0, 'a hinge on a geared wheel relinks its gear');
  assert.equal(
    many.hingeWork,
    few.hingeWork,
    'the hinge costs the same beside 40 joints as beside 4',
  );
});

test('gear linking: a wheel whose hinge is taken out and made again is held in phase', async () => {
  const rig = await jointRig([0, 0, 0]);
  const [driver, driven] = [rig.cube(0, 0, 0), rig.cube(3, 0, 0)];
  rig.wanted.add(joint.hinge(driver, null));
  const first = joint.hinge(driven, null);
  rig.wanted.add(first);
  // 24 teeth driving 12: the driven wheel turns twice per turn of the driver.
  rig.wanted.add(joint.gear(driver, driven, { ratio: 2 }));
  rig.run(1);
  rig.wanted.delete(first);
  rig.run(1);
  rig.wanted.add(joint.hinge(driven, null));
  rig.run(1);
  const turns = [driver, driven].map((body) => turnOf(rig, body));
  const phase = () => {
    const [t0, t1] = turns.map((turn) => turn());
    return t1 + 2 * t0;
  };
  const before = phase();
  // Turned a third of a radian out of mesh: only the gear's position correction, reading the
  // hinges it was handed, brings it back.
  const half = 1 / 6;
  rig.writer.teleport(driven.physics!._index, rig.at(driven), [
    0,
    Math.sin(half),
    0,
    Math.cos(half),
  ]);
  rig.run(1);
  assert.ok(Math.abs(phase() - before) > 0.1, 'the wheel was turned out of mesh');
  rig.run(120);
  const error = Math.abs(phase() - before);
  const tolerance = (2 * Math.PI) / 12 / 100;
  assert.ok(error < tolerance, `back in phase after the hinge came back: ${error} < ${tolerance}`);
});
