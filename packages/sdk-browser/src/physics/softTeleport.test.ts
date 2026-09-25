import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_INDEX, CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import { castDown } from './module.fixture.ts';
import { CLOTH, flatCloth, FLOOR, settle, softWorld } from './soft.fixture.ts';

test('a soft body teleported and turned takes its vertices along as they lie, its simulation kept', async () => {
  const jolt = await softWorld();
  // Made 1 m up at the origin, it falls and comes to rest on the floor: Jolt has since kept its
  // body at the centre of its vertices, 1 m under the place it was made.
  const record = flatCloth(jolt, 1, []);
  const rest = settle(jolt, record, 2);
  const writer = new CommandWriter();
  // Past the floor's edge, 20 m out: nothing else there for a ray to hit. Turned a quarter about
  // the vertical (FLAT, then 90° about y): its vertices, in its own frame, are where they lay.
  writer.teleport(CLOTH & BODY_INDEX, [25, 1, 0], [-0.5, 0.5, 0.5, 0.5]);
  jolt.step(writer.take(), 0);
  const moved = settle(jolt, record, 1 / 60);
  for (let i = 0; i < rest.length; i++)
    assert.ok(Math.abs(moved[i] - rest[i]) < 0.01, `${i}: ${rest[i]} → ${moved[i]}`);
  assert.equal(castDown(jolt, 25)[0], CLOTH, 'it lies where it was sent');
  assert.equal(castDown(jolt, 0)[0], FLOOR, 'and left where it was');
});
