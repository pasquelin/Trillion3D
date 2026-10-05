import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_BIT,
  BODY_INDEX,
  DEFAULT_PHYSICS_BUDGET,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { beforesAt, resultWords } from './protocol.ts';
import { createTickResults } from './tickResults.ts';
import { tickModule } from './tickResults.fixture.ts';
import { random } from '../page/cut/cutRuleChecks.fixture.ts';

/** NaN, -NaN, ±0, ±Inf and the largest finite float, as words a pose can carry. */
const EDGES = [0x7fc00000, 0xffc00001, 0, 0x80000000, 0x7f800000, 0xff800000, 0x7f7fffff];

/** One step's records as the module writes them: each body once, in any order. */
function stepRecords(next: () => number, bodies: number, count: number) {
  const order = Array.from({ length: bodies }, (_, i) => i).sort(() => next() - 0.5);
  const words = new Uint32Array(count * POSE_WORDS);
  for (let r = 0; r < count; r++) {
    const generation = Math.floor(next() * 128) << 24;
    words[r * POSE_WORDS] = (order[r] | generation | (next() < 0.2 ? ASLEEP_BIT : 0)) >>> 0;
    for (let k = 1; k < POSE_WORDS; k++)
      words[r * POSE_WORDS + k] =
        next() < 0.1 ? EDGES[Math.floor(next() * EDGES.length)] : (next() * 2 ** 32) >>> 0;
  }
  return words;
}

/** `poses` and `befores` (`n` words each) end to end, a slot's earlier pose the tick does not
 *  hold — its id word another body's — read as its id word alone: the rest is never read. */
function joined(poses: Uint32Array, befores: Uint32Array, n: number) {
  const out = Uint32Array.of(...poses.subarray(0, n), ...befores.subarray(0, n));
  for (let at = 0; at < n; at += POSE_WORDS)
    if (((out[n + at] ^ out[at]) & ~ASLEEP_BIT) !== 0) out.fill(0, n + at + 1, n + at + POSE_WORDS);
  return out;
}

/** One run's records, `stepped` when it took a step (else commands run in place). */
type Run = { words: Uint32Array; stepped: boolean };

/** The gather record by record, each slot's record of the step before kept apart (its id word
 *  inverted when the tick met it once); a run of no step that changed a record moved it in place,
 *  its new copy its step before too, one that did not changes nothing: the frozen oracle, both
 *  lists end to end. */
function recordByRecord(steps: Run[], bodies: number) {
  const slotOf = new Int32Array(bodies),
    stamp = new Int32Array(bodies).fill(-1),
    out = new Uint32Array(bodies * POSE_WORDS),
    before = new Uint32Array(bodies * POSE_WORDS);
  let poseCount = 0;
  for (const { words, stepped } of steps)
    for (let r = 0; r < words.length / POSE_WORDS; r++) {
      const at = r * POSE_WORDS,
        index = words[at] & BODY_INDEX;
      if (stamp[index] !== 0) {
        [stamp[index], slotOf[index]] = [0, poseCount++];
        before[slotOf[index] * POSE_WORDS] = ~words[at];
      } else {
        const o = slotOf[index] * POSE_WORDS,
          fresh = words.subarray(at, at + POSE_WORDS);
        if (stepped) before.set(out.subarray(o, o + POSE_WORDS), o);
        else if (fresh.some((word, k) => word !== out[o + k])) before.set(fresh, o);
      }
      out.set(words.subarray(at, at + POSE_WORDS), slotOf[index] * POSE_WORDS);
    }
  return joined(out, before, poseCount * POSE_WORDS);
}

/** Every tick's posted poses, `ticks` holding each tick's steps; `staged` starts with no free
 *  result buffer, so the first tick is kept in the staging copy. */
function gathered(ticks: Run[][], bodies: number, staged: boolean) {
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies, contactEvents: 4 };
  let step: Uint32Array = new Uint32Array(0);
  const jolt = tickModule(
    () => step,
    () => new Uint32Array(0),
  );
  const buffers = staged ? [] : [new ArrayBuffer(resultWords(budget) * 4)];
  const posted: Uint32Array[] = [];
  const results = createTickResults(jolt, budget, buffers, (message) => {
    if (message.type !== 'results') return;
    const words = new Uint32Array(message.buffer);
    posted.push(joined(words, words.subarray(beforesAt(budget)), message.poses * POSE_WORDS));
    buffers.push(message.buffer);
  });
  for (const steps of ticks) {
    for (const { words, stepped } of steps) {
      step = words;
      results.gather(words.length / POSE_WORDS, stepped);
    }
    if (!buffers.length) buffers.push(new ArrayBuffer(resultWords(budget) * 4));
    const after = { active: 0, step: 0, resting: false, heard: 0 };
    results.post({ steps: steps.length, stepMs: 0, stepMaxMs: 0 }, after, () => null, []);
  }
  return posted;
}

test("a tick's poses and their steps before match the record-by-record gather, block-copied first steps and runs of no step included", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const next = random(seed),
      bodies = 1 + Math.floor(next() * 64);
    // Empty steps, a full one (every body), and random ones, one to four runs a tick, one in
    // five of no step.
    const size = () => [0, bodies][Math.floor(next() * 4)] ?? Math.floor(next() * (bodies + 1));
    const run = (): Run => ({ words: stepRecords(next, bodies, size()), stepped: next() >= 0.2 });
    const ticks = Array.from({ length: 6 }, () =>
      Array.from({ length: 1 + Math.floor(next() * 4) }, run),
    );
    const expected = ticks.map((steps) => recordByRecord(steps, bodies)).filter((p) => p.length);
    for (const staged of [false, true])
      assert.deepEqual(
        gathered(ticks, bodies, staged).filter((p) => p.length),
        expected,
        `seed ${seed}${staged ? ', staged' : ''}`,
      );
  }
});
