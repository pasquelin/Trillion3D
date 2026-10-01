import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_SPECS } from './vehicleSpec.ts';

const specs = Object.entries(VEHICLE_SPECS);

test('every machine is whole: each number set and finite, each list ordered', () => {
  for (const [kind, spec] of specs) {
    for (const [name, value] of Object.entries(spec))
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${kind} ${name}`);
    assert.ok(
      spec.gears.length > 0 && spec.gears.every((ratio, i) => i === 0 || ratio < spec.gears[i - 1]),
    );
    assert.ok(Object.isFrozen(spec), kind);
  }
  assert.ok(Object.isFrozen(VEHICLE_SPECS));
});

test('the gearboxes shift down below where an upshift lands, and up below the redline', () => {
  for (const [kind, spec] of specs) {
    const steps = spec.gears.slice(1).map((ratio, i) => ratio / spec.gears[i]);
    assert.ok(spec.shiftDownRPM < spec.shiftUpRPM * Math.min(...steps), `${kind} never hunts`);
    assert.ok(spec.shiftUpRPM < spec.maxRPM, `${kind} redline`);
    assert.ok(spec.idleRPM < spec.shiftDownRPM, `${kind} above idle`);
  }
});

test('each torque curve runs from standstill to the redline, its peak the engine’s', () => {
  for (const [kind, { torqueCurve }] of specs) {
    const rpms = torqueCurve.map(([rpm]) => rpm),
      torques = torqueCurve.map(([, torque]) => torque);
    assert.deepEqual([rpms[0], rpms.at(-1)], [0, 1], kind);
    assert.ok(
      rpms.every((rpm, i) => i === 0 || rpm > rpms[i - 1]),
      `${kind} rising`,
    );
    assert.equal(Math.max(...torques), 1, `${kind} peak`);
    assert.ok(
      torques.every((torque) => torque > 0),
      kind,
    );
  }
});

test('every machine is a road vehicle’s: torque per kilogram, final drive, lean', () => {
  // A road machine's peak torque runs from a heavy truck's 0.05 N·m/kg to a sports car's 0.4; its
  // final drive reduces the gearbox's turns by 2 to 10; a street motorcycle leans 30 to 60°.
  for (const [kind, spec] of specs) {
    assert.ok(spec.torquePerKg > 0.05 && spec.torquePerKg < 0.5, `${kind} ${spec.torquePerKg}`);
    assert.ok(spec.finalDrive > 2 && spec.finalDrive < 10, `${kind} ${spec.finalDrive}`);
  }
  const lean = VEHICLE_SPECS.motorcycle.maxLean;
  assert.ok(lean > Math.PI / 6 && lean < Math.PI / 3, `${lean} rad`);
});
