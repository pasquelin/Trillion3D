import test from 'node:test';
import assert from 'node:assert/strict';
import { joint } from '../../../sdk-core/src/physics/index.ts';
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { jointRig, type Rig } from './joints.fixture.ts';

/**
 * Two bodies driven past a 0.4 stop by the same motor, one stop soft: the soft one passes it, then
 * springs back to it once the motor stops; the hard one never passes it.
 */
async function softAndHardStop(kind: 'hinge' | 'slider', read: (rig: Rig, mesh: Mesh) => number) {
  const rig = await jointRig([0, 0, 0]);
  const motor = { mode: 'velocity', target: 2, maxForce: 1e5 } as const;
  const stop = (z: number) => {
    const body = rig.cube(0.5, 1, z);
    const axis = kind === 'hinge' ? ([0, 1, 0] as const) : ([1, 0, 0] as const);
    return {
      body,
      options: { anchor: [0, 1, z] as const, axis, limits: { min: 0, max: 0.4 }, motor },
    };
  };
  const [soft, hard] = [stop(0), stop(5)];
  const spring = { frequency: 2, damping: 1 };
  const joints = [
    joint[kind](soft.body, null, { ...soft.options, spring }),
    joint[kind](hard.body, null, hard.options),
  ];
  for (const j of joints) rig.wanted.add(j);
  rig.run(30);
  const pushed = [read(rig, soft.body), read(rig, hard.body)];
  for (const j of joints) j.motor = null;
  rig.run(120);
  return { pushed, rest: read(rig, soft.body) };
}

test('hinge: a soft limit lets the door turn past its stop and springs it back; a hard one does not', async () => {
  const { pushed, rest } = await softAndHardStop('hinge', (rig, mesh) => rig.yaw(mesh));
  assert.ok(pushed[0] > 0.5, `the soft stop gives: ${pushed[0]}`);
  assert.ok(Math.abs(pushed[1] - 0.4) < 0.05, `the hard stop holds: ${pushed[1]}`);
  assert.ok(rest > 0 && rest < 0.45, `sprung back within its stops: ${rest}`);
});

test('slider: a soft limit lets the drawer slide past its stop and springs it back; a hard one does not', async () => {
  const { pushed, rest } = await softAndHardStop('slider', (rig, mesh) => rig.at(mesh)[0] - 0.5);
  assert.ok(pushed[0] > 0.5, `the soft stop gives: ${pushed[0]}`);
  assert.ok(Math.abs(pushed[1] - 0.4) < 0.03, `the hard stop holds: ${pushed[1]}`);
  assert.ok(rest > 0 && rest < 0.45, `sprung back within its stops: ${rest}`);
});
