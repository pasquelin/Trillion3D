import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_BIT,
  BODY_INDEX,
  CommandWriter,
  EVENT,
  EVENT_WORDS,
  FLAG,
  GENERATION_SHIFT,
  POSE_WORDS,
  SHAPE,
} from '../../../sdk-core/src/physics/index.ts';
import { body, startModule, type Module } from './module.fixture.ts';

const id = (slot: number, generation: number) => slot | (generation << GENERATION_SHIFT);
/** A floor in slot 0, then `boxes` boxes (events wanted when `listening`), stacked from y = 1. */
function pile(jolt: Module, boxes: number, listening = false) {
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add(body(id(0, 1), 0, -1, 1));
  for (let i = 1; i <= boxes; i++)
    writer.add(body(id(i, 1), 2, i * 1.05, 0.5, listening ? FLAG.events : 0));
  jolt.step(writer.take(), 0);
}
/** The (type, a, b) of the last step's events. */
const events = (jolt: Module) => {
  const words = jolt.events();
  return Array.from({ length: words.length / EVENT_WORDS }, (_, r) =>
    [0, 1, 2].map((k) => words[r * EVENT_WORDS + k]),
  );
};
const step = (jolt: Module, writer?: CommandWriter) => jolt.step(writer?.take() ?? null, 1 / 60);

test('a body added in the slot of one removed awake, in the same batch, is not reported asleep', async () => {
  const jolt = await startModule();
  pile(jolt, 1);
  for (let s = 0; s < 3; s++) step(jolt);
  const writer = new CommandWriter();
  writer.remove(1);
  writer.add(body(id(1, 3), 2, 5, 0.5));
  const count = step(jolt, writer);
  const words = jolt.poses(count);
  const mine = Array.from({ length: count }, (_, r) => words[r * POSE_WORDS]).filter(
    (word) => (word & BODY_INDEX) === 1,
  );
  assert.deepEqual(mine, [id(1, 3)], 'one awake record, of the new body');
});

test('a body removed while touching sends its leave at once, under its own generation', async () => {
  const jolt = await startModule();
  pile(jolt, 1, true);
  let entered = false;
  for (let s = 0; s < 120 && !entered; s++) {
    step(jolt);
    entered = events(jolt).some(([type]) => type === EVENT.begin);
  }
  assert.ok(entered, 'the box lands');
  const writer = new CommandWriter();
  writer.remove(1);
  writer.add(body(id(1, 3), 2, 0.5, 0.5, FLAG.events));
  step(jolt, writer);
  const leaves = events(jolt).filter(([type]) => type === EVENT.end);
  assert.deepEqual(leaves, [[EVENT.end, id(0, 1), id(1, 1)]]);
});

test('a step past the contact budgets says so', async () => {
  const jolt = await startModule({ bodyPairs: 2, contactConstraints: 2 });
  pile(jolt, 6);
  let overflow: string[] = [];
  for (let s = 0; s < 120 && !overflow.length; s++) {
    step(jolt);
    overflow = jolt.overflow();
  }
  assert.ok(overflow.length, 'an exhausted budget is named');
});

test('an enter past the events budget is counted, and its leave never sent', async () => {
  const jolt = await startModule({ contactEvents: 1 });
  pile(jolt, 1, true);
  const writer = new CommandWriter();
  writer.add(body(id(2, 1), 2, 0.5, 0.5, FLAG.events));
  // Two boxes land on the floor in one step: two enters for one event word.
  writer.add({ ...body(id(3, 1), 2, 0.5, 0.5, FLAG.events), position: [3, 0.5, 0] });
  step(jolt, writer);
  let dropped = jolt.dropped();
  for (let s = 0; s < 120 && !dropped; s++) dropped = step(jolt) >= 0 ? jolt.dropped() : 0;
  assert.ok(dropped > 0, 'the dropped enter is counted');
  const removal = new CommandWriter();
  for (const slot of [1, 2, 3]) removal.remove(slot);
  const seen = new Set<number>();
  for (let s = 0; s < 4; s++) {
    step(jolt, s ? undefined : removal);
    for (const [type, a, b] of events(jolt)) if (type === EVENT.end) seen.add(a ^ b);
  }
  assert.ok(seen.size < 3, 'no leave for the enter that was never sent');
});

test('a shape the module refuses fails its body alone; the world steps on', async () => {
  const jolt = await startModule();
  pile(jolt, 1);
  const writer = new CommandWriter();
  const flat = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  writer.add({ ...body(id(2, 1), 2, 3, 0), shape: SHAPE.hull, vertices: flat });
  writer.wake(2);
  step(jolt, writer);
  assert.deepEqual(jolt.refused(), [id(2, 1)]);
  const removal = new CommandWriter();
  removal.remove(2);
  step(jolt, removal);
  assert.ok(step(jolt) >= 0 && jolt.active() === 1, 'the other body still falls');
  assert.equal(jolt.poses(1)[0] & ~ASLEEP_BIT, id(1, 1));
});

test('a leave the event buffer cannot take is owed, and sent first at the next step', async () => {
  const jolt = await startModule({ contactEvents: 1 });
  pile(jolt, 1, true);
  const writer = new CommandWriter();
  // A second box lands on the first: two pairs, each enter in a step of its own.
  writer.add(body(id(2, 1), 2, 3, 0.5, FLAG.events));
  const enters = new Set<number>();
  for (let s = 0; s < 240 && enters.size < 2; s++) {
    step(jolt, s ? undefined : writer);
    for (const [type, a, b] of events(jolt)) if (type === EVENT.begin) enters.add(a ^ b);
  }
  assert.equal(enters.size, 2, 'both pairs touch');
  // The first box leaves both pairs at once, with room for one event.
  const removal = new CommandWriter();
  removal.remove(1);
  step(jolt, removal);
  const first = events(jolt);
  assert.equal(first.length, 1, 'one leave fits the buffer');
  assert.equal(jolt.owedLeaves(), 1, 'the other one is owed');
  jolt.step(null, 0);
  const second = events(jolt);
  assert.equal(second.length, 1, 'the owed leave comes at the next step');
  const leaves = [...first, ...second].map(([type, a, b]) => (type === EVENT.end ? a ^ b : -1));
  assert.deepEqual(new Set(leaves), enters);
  assert.equal(jolt.owedLeaves(), 0);
});
