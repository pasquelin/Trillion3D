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
