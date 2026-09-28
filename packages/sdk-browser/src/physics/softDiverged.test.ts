import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_INDEX, CommandWriter, EVENT, FLAG } from '../../../sdk-core/src/physics/index.ts';
import { events, startModule, type Module } from './module.fixture.ts';
import { addBox, BOX, CLOTH, flatCloth, FLOOR, settle, softWorld } from './soft.fixture.ts';
import { stateDump } from './stateDump.fixture.ts';

/** `stateDump`'s motion as develop's module simulated it, which simulated this scene as it did
 *  before PHY-09 and PHY-10; taken again apart from the vertices when PHY-06 rounded them (#975),
 *  and again with each step's events sorted, develop's module giving it too (#934). */
const DEVELOP_MOTION = 'd54edc7d4da4d89a53292e152a575d5760cd6b3326128592eb1a87f280200692';
/** `stateDump` whole, vertices bit for bit, as the write-back of one matrix per body gives it. */
const FULL_DUMP = '7f90142b87ab6134a91cfe14e6825cc2312ff6ce1a80591f029f58bf6d75fcc2';

test('a finite scene steps exactly as before, but for pinned cloths that never stretch', async () => {
  assert.deepEqual(stateDump(await startModule()), { motion: DEVELOP_MOTION, full: FULL_DUMP });
});

/** A module whose cloth rests on the floor and on a box (the pairs entered), all wanting events;
 *  then the body `index` sent to `x`, not finite, in a step of no time. */
async function spoiled(index: number, x: number, cone = false) {
  const jolt = await softWorld();
  const record = flatCloth(jolt, 1, [], true);
  addBox(jolt, 1, 0.1, FLAG.events);
  settle(jolt, record, 2);
  const writer = new CommandWriter();
  // A view cone: a body gone non-finite is in none, and is named all the same.
  if (cone) writer.view([0, 1, 5], [0, 0, -1], 0.5, 400);
  writer.teleport(index & BODY_INDEX, [x, 1, 0], [0, 0, 0, 1]);
  const posed = jolt.step(writer.take(), 0);
  return { jolt, record, posed };
}

/** The bodies the last step's leaves named beside `id`, sorted. */
const leftBy = (jolt: Module, id: number) =>
  events(jolt)
    .filter((e) => e[0] === EVENT.end && (e[1] === id || e[2] === id))
    .map((e) => (e[1] === id ? e[2] : e[1]))
    .sort();

test('a soft body whose vertices go non-finite sends none, is named once, and leaves', async () => {
  for (const x of [NaN, Infinity, -Infinity]) {
    const { jolt, record } = await spoiled(CLOTH, x);
    assert.equal(jolt.soft().length, 0, `${x}: no vertex reaches the page`);
    assert.deepEqual(jolt.diverged(), [CLOTH], `${x}: named`);
    assert.deepEqual(leftBy(jolt, CLOTH), [FLOOR, BOX].sort(), `${x}: its pairs left`);
    // Commands the page wrote before it heard are skipped; its removal frees the slot.
    const writer = new CommandWriter();
    writer.teleport(CLOTH & BODY_INDEX, [0, 1, 0], [0, 0, 0, 1]);
    jolt.step(writer.take(), 1 / 60);
    assert.deepEqual(jolt.diverged(), [], `${x}: named once`);
    writer.remove(CLOTH & BODY_INDEX);
    jolt.step(writer.take(), 0);
    flatCloth(jolt, 1, []);
    assert.ok(settle(jolt, record, 1 / 60).every(Number.isFinite), `${x}: a new body takes it`);
  }
});

test('a rigid body whose pose goes non-finite sends none, is named once, and leaves', async () => {
  for (const [x, cone] of [NaN, Infinity, -Infinity].flatMap(
    (x) =>
      [
        [x, false],
        [x, true],
      ] as const,
  )) {
    const { jolt, posed } = await spoiled(BOX, x, cone);
    assert.equal(posed, 0, `${x}: no pose reaches the page`);
    assert.deepEqual(jolt.diverged(), [BOX], `${x}: named`);
    assert.deepEqual(leftBy(jolt, BOX), [FLOOR, CLOTH].sort(), `${x}: its pairs left`);
    jolt.step(null, 1 / 60);
    assert.deepEqual(jolt.diverged(), [], `${x}: named once`);
  }
});
