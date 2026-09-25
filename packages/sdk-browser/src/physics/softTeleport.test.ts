import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import { castDown } from './module.fixture.ts';
import { FLAT, flatCloth, settle, softWorld } from './soft.fixture.ts';

const FLOOR = 1 << 24,
  CLOTH = 1 | (1 << 24);

test('a soft body teleported takes its vertices along as they lie, its simulation kept', async () => {
  const jolt = await softWorld();
  // Made 1 m up at the origin, it falls and comes to rest on the floor: Jolt has since kept its
  // body at the centre of its vertices, 1 m under the place it was made.
  const record = flatCloth(jolt, 1, []);
  const rest = settle(jolt, record, 2);
  const writer = new CommandWriter();
  // Past the floor's edge, 20 m out: nothing else there for a ray to hit.
  writer.teleport(1, [25, 1, 0], FLAT);
  jolt.step(writer.take(), 0);
  const moved = settle(jolt, record, 1 / 60);
  for (let i = 0; i < rest.length; i++)
    assert.ok(Math.abs(moved[i] - rest[i]) < 0.01, `${i}: ${rest[i]} → ${moved[i]}`);
  assert.equal(castDown(jolt, 25)[0], CLOTH, 'it lies where it was sent');
  assert.equal(castDown(jolt, 0)[0], FLOOR, 'and left where it was');
});
