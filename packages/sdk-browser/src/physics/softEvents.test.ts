import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter, EVENT, FLAG } from '../../../sdk-core/src/physics/index.ts';
import { body, events } from './module.fixture.ts';
import type { Module } from './module.fixture.ts';
import { addBox, at, flatCloth, settle, softWorld } from './soft.fixture.ts';

const FLOOR = 1 << 24,
  CLOTH = 1 | (1 << 24),
  BOX = 2 | (1 << 24);
/** A step's events: `[type, a, b, impulse]`. */
function step(jolt: Module, words: Uint32Array | null = null) {
  jolt.step(words, 1 / 60);
  return events(jolt);
}
/** Steps until an event of `type` between `a` and `b` (in either order), at most `seconds`; the
 *  first step runs `words`. */
function until(
  jolt: Module,
  type: number,
  a: number,
  b: number,
  seconds = 3,
  words: Uint32Array | null = null,
) {
  for (let s = 0; s < seconds * 60; s++)
    for (const e of step(jolt, s ? null : words))
      if (e[0] === type && ((e[1] === a && e[2] === b) || (e[1] === b && e[2] === a))) return e;
  return null;
}
/** The border of a cloth of 10 × 10 squares: pinned there, it is a trampoline. */
const BORDER = Array.from({ length: 121 }, (_, v) => v).filter(
  (v) => v < 11 || v > 109 || v % 11 === 0 || v % 11 === 10,
);

test('a soft body that wants events hears the floor it lands on, once, and keeps it asleep', async () => {
  const jolt = await softWorld();
  flatCloth(jolt, 1, [], true);
  const enter = until(jolt, EVENT.begin, CLOTH, FLOOR);
  assert.ok(enter, 'it lands: an enter');
  assert.ok(enter[3] > 0.2 * 3, `the impulse of 0.2 kg landing at 4 m/s: ${enter[3]} N·s`);
  let events = 0;
  while (jolt.active() > 0) events += step(jolt).length;
  jolt.step(null, 1 / 60);
  assert.equal(events, 0, 'resting, then asleep on the floor: no enter again, no leave');
  const quiet = await softWorld();
  flatCloth(quiet, 1, [], false);
  assert.equal(until(quiet, EVENT.begin, CLOTH, FLOOR), null, 'no events wanted, none sent');
});

test('a body that wants events hears the cloth it lands on, and leaves it thrown up', async () => {
  const jolt = await softWorld();
  flatCloth(jolt, 1, BORDER, false);
  addBox(jolt, 0.1, 1.5, FLAG.events);
  // It lands at 2.8 m/s on a cloth at rest: its 0.1 kg against the vertices it meets.
  const enter = until(jolt, EVENT.begin, CLOTH, BOX);
  assert.ok(enter && enter[3] > 0.01 && enter[3] < 0.1 * 3, `the box lands on the cloth: ${enter}`);
  jolt.step(null, 0);
  assert.equal(jolt.events().length, 0, 'a step that does not collide leaves nothing');
  const writer = new CommandWriter();
  writer.velocity(2, [0, 6, 0]);
  assert.ok(until(jolt, EVENT.end, CLOTH, BOX, 1, writer.take()), 'thrown up, it leaves');
  assert.equal(until(jolt, EVENT.begin, CLOTH, BOX, 0.5), null, 'in the air, it is not back');
});

test('a soft body removed while it touches sends its leave, and a sensor lets it through', async () => {
  const jolt = await softWorld();
  flatCloth(jolt, 1, [0, 10, 110, 120], true);
  addBox(jolt, 1, 1.5);
  assert.ok(until(jolt, EVENT.begin, CLOTH, BOX));
  const writer = new CommandWriter();
  writer.remove(1);
  assert.ok(
    step(jolt, writer.take()).some((e) => e[0] === EVENT.end),
    'removed, its leave is sent',
  );
  // A sensor box across the cloth's fall: an enter with no impulse, and the cloth reaches the floor.
  const through = await softWorld();
  const add = new CommandWriter();
  add.add(body(BOX, 0, 0.5, 0.3, FLAG.sensor | FLAG.events));
  through.step(add.take(), 0);
  const record = flatCloth(through, 1, [], false);
  const sensed = until(through, EVENT.begin, CLOTH, BOX);
  assert.ok(sensed && sensed[3] === 0, `the sensor hears it: ${sensed}`);
  // Laid flat, the cloth's own −z is the world's down: it fell its metre to the floor.
  assert.ok(at(settle(through, record, 2), 60)[2] < -0.95, 'it falls through the sensor');
});

test('a body taken away from a soft body asleep leaves it, though the soft body sleeps on', async () => {
  const jolt = await softWorld();
  // A cloth that fell on a kinematic table, 0.6 m high, and came to rest over it.
  const add = new CommandWriter();
  add.add(body(BOX, 1, 0.3, 0.3));
  jolt.step(add.take(), 0);
  flatCloth(jolt, 1, [], true);
  let last = until(jolt, EVENT.begin, CLOTH, BOX)?.[0];
  for (let s = 0; s < 1800 && jolt.active() > 0; s++)
    for (const e of step(jolt)) if (e[1] + e[2] === CLOTH + BOX) last = e[0];
  assert.equal(jolt.active(), 0, 'asleep');
  assert.equal(last, EVENT.begin, 'asleep, the cloth still lies on the table');
  assert.equal(step(jolt).length, 0, 'asleep, nothing is sent');
  const writer = new CommandWriter();
  writer.teleport(2, [5, 0.3, 0], [0, 0, 0, 1]);
  assert.ok(until(jolt, EVENT.end, CLOTH, BOX, 1, writer.take()), 'taken away, it leaves');
});
