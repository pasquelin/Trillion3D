import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PHYSICS_BUDGET,
  EVENT_WORDS,
  MAX_CATCH_UP_STEPS,
} from '../../../sdk-core/src/physics/index.ts';
import type { JoltModule } from './joltModule.ts';
import { resultWords } from './protocol.ts';
import { createTickResults } from './tickResults.ts';

test('a tick steps on only while one more step of events fits its results', () => {
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 4, contactEvents: 3 };
  // A module whose every step fills the events budget, and moves nothing.
  const jolt = {
    poses: () => new Uint32Array(0),
    events: () => new Uint32Array(budget.contactEvents * EVENT_WORDS),
    dropped: () => 0,
    refused: () => [],
    broken: () => [],
    overflow: () => [],
    vehicles: () => new Uint32Array(0),
    soft: () => new Uint32Array(0),
  } as unknown as JoltModule;
  const buffers = [new ArrayBuffer(resultWords(budget) * 4)];
  const sent: unknown[] = [];
  const results = createTickResults(jolt, budget, buffers, (message) => sent.push(message));
  let steps = 0;
  while (results.room()) {
    results.gather(0);
    steps++;
  }
  assert.equal(steps, MAX_CATCH_UP_STEPS, 'as many steps as the results hold, none cut');
  const work = { steps, stepMs: 12, stepMaxMs: 7 };
  assert.ok(results.post(work, 1, () => null, { time: 0, epoch: 0 }));
  assert.ok(results.room(), 'a posted tick frees the room');
  assert.equal(sent.length, 1);
  assert.deepEqual(
    [(sent[0] as { stepMs: number }).stepMs, (sent[0] as { stepMaxMs: number }).stepMaxMs],
    [12, 7],
    'the tick carries its steps total and its slowest step apart',
  );
});
