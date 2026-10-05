import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PHYSICS_BUDGET,
  EVENT_WORDS,
  MAX_CATCH_UP_STEPS,
} from '../../../sdk-core/src/physics/index.ts';
import { resultWords } from './protocol.ts';
import { createTickResults } from './tickResults.ts';
import { tickModule } from './tickResults.fixture.ts';

const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 4, contactEvents: 3 };

/** A module whose every step fills the events budget, and moves nothing; `diverged` the bodies
 *  each step leaves non-finite, `recovered` the soft bodies it brings back to a good state. The tick's
 *  results over it, and what they sent. */
function tickOver(diverged: number[] = [], recovered: number[] = []) {
  const jolt = tickModule(
    () => new Uint32Array(0),
    () => new Uint32Array(budget.contactEvents * EVENT_WORDS),
    diverged,
    recovered,
  );
  const buffers = [new ArrayBuffer(resultWords(budget) * 4)];
  const sent: unknown[] = [];
  return {
    results: createTickResults(jolt, budget, buffers, (message) => sent.push(message)),
    sent,
  };
}

test('a tick steps on only while one more step of events fits its results', () => {
  const { results, sent } = tickOver();
  let steps = 0;
  while (results.room()) {
    results.gather(0, true);
    steps++;
  }
  assert.equal(steps, MAX_CATCH_UP_STEPS, 'as many steps as the results hold, none cut');
  const work = { steps, stepMs: 12, stepMaxMs: 7 };
  assert.ok(
    results.post(work, { active: 1, step: steps, resting: false, heard: 0 }, () => null, []),
  );
  assert.ok(results.room(), 'a posted tick frees the room');
  assert.equal(sent.length, 1);
  assert.deepEqual(
    [(sent[0] as { stepMs: number }).stepMs, (sent[0] as { stepMaxMs: number }).stepMaxMs],
    [12, 7],
    'the tick carries its steps total and its slowest step apart',
  );
});

test('a step that brings soft bodies back to a good state names them to the page, apart from the bodies it takes out', () => {
  const { results, sent } = tickOver([], [9, 11]);
  results.gather(0, true);
  assert.deepEqual(sent, [{ type: 'recovered', bodies: [9, 11] }]);
  const none = tickOver();
  none.results.gather(0, true);
  assert.deepEqual(none.sent, [], 'none brought back, nothing said');
});

test('a step that leaves bodies non-finite names them to the page, which takes them out', () => {
  const { results, sent } = tickOver([5, 7]);
  results.gather(0, true);
  assert.deepEqual(sent, [
    {
      type: 'error',
      code: 'PHYSICS_DIVERGED',
      message: 'Physics: 2 body(ies) went non-finite and left the simulation.',
      fatal: false,
      bodies: [5, 7],
    },
  ]);
});

test('the character’s feet reach the page as a record, with their state a step before', () => {
  // The module's character state (`jolt_character`): present, then its feet.
  let feet = Float32Array.of(1, 0, 0, 0);
  const jolt = {
    ...tickModule(
      () => new Uint32Array(0),
      () => new Uint32Array(0),
    ),
  };
  Object.assign(jolt, { character: () => feet });
  const sent: { feet?: { words: Uint32Array; befores: Uint32Array | null } }[] = [];
  const buffers = [new ArrayBuffer(resultWords(budget) * 4)];
  const results = createTickResults(jolt, budget, buffers, (m) => sent.push(m as never));
  for (const x of [1, 2]) {
    feet = Float32Array.of(1, x, 0, 0);
    results.gather(0, true);
  }
  results.post(
    { steps: 2, stepMs: 0, stepMaxMs: 0 },
    { active: 0, step: 2, resting: false, heard: 0 },
    () => null,
    [],
  );
  const { words, befores } = sent[0].feet!;
  const x = (w: Uint32Array) => new Float32Array(w.buffer, 8, 1)[0];
  assert.deepEqual([x(words), x(befores!)], [2, 1], 'the newest, and the step before it');
});
