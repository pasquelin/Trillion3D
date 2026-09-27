import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_BIT,
  BODY_INDEX,
  DEFAULT_PHYSICS_BUDGET,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import type { JoltModule } from './joltModule.ts';
import { resultWords } from './protocol.ts';
import { createTickResults } from './tickResults.ts';

/** NaN, -NaN, ±0, ±Inf and the largest finite float, as words a pose can carry. */
const EDGES = [0x7fc00000, 0xffc00001, 0, 0x80000000, 0x7f800000, 0xff800000, 0x7f7fffff];

/** A random generator the runs repeat (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** The gather as develop wrote it, record by record: the frozen oracle. */
function recordByRecord(steps: Uint32Array[], bodies: number) {
  const slotOf = new Int32Array(bodies),
    stamp = new Int32Array(bodies).fill(-1),
    out = new Uint32Array(bodies * POSE_WORDS);
  let poseCount = 0;
  for (const words of steps)
    for (let r = 0; r < words.length / POSE_WORDS; r++) {
      const at = r * POSE_WORDS,
        index = words[at] & BODY_INDEX;
      if (stamp[index] !== 0) [stamp[index], slotOf[index]] = [0, poseCount++];
      out.set(words.subarray(at, at + POSE_WORDS), slotOf[index] * POSE_WORDS);
    }
  return out.subarray(0, poseCount * POSE_WORDS);
}

/** Every tick's posted poses, `ticks` holding each tick's steps; `staged` starts with no free
 *  result buffer, so the first tick is kept in the staging copy. */
function gathered(ticks: Uint32Array[][], bodies: number, staged: boolean) {
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies, contactEvents: 4 };
  let step: Uint32Array = new Uint32Array(0);
  const jolt = {
    poses: () => step,
    events: () => new Uint32Array(0),
    dropped: () => 0,
    refused: () => [],
    broken: () => [],
    overflow: () => [],
    vehicles: () => new Uint32Array(0),
    soft: () => new Uint32Array(0),
  } as unknown as JoltModule;
  const buffers = staged ? [] : [new ArrayBuffer(resultWords(budget) * 4)];
  const posted: Uint32Array[] = [];
  const results = createTickResults(jolt, budget, buffers, (message) => {
    if (message.type !== 'results') return;
    posted.push(new Uint32Array(message.buffer, 0, message.poses * POSE_WORDS).slice());
    buffers.push(message.buffer);
  });
  for (const steps of ticks) {
    for (const words of steps) {
      step = words;
      results.gather(words.length / POSE_WORDS);
    }
    if (!buffers.length) buffers.push(new ArrayBuffer(resultWords(budget) * 4));
    results.post(
      { steps: steps.length, stepMs: 0, stepMaxMs: 0 },
      0,
      () => null,
      {
        time: 0,
        epoch: 0,
      },
      [],
    );
  }
  return posted;
}

test("a tick's poses match the record-by-record gather, block-copied first steps included", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const next = random(seed),
      bodies = 1 + Math.floor(next() * 64);
    // Empty steps, a full one (every body), and random ones, one to four steps a tick.
    const size = () => [0, bodies][Math.floor(next() * 4)] ?? Math.floor(next() * (bodies + 1));
    const ticks = Array.from({ length: 6 }, () =>
      Array.from({ length: 1 + Math.floor(next() * 4) }, () => stepRecords(next, bodies, size())),
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
