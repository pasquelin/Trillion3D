import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandWriter,
  EVENT_WORDS,
  FLAG,
  GENERATION_SHIFT,
  POSE_WORDS,
  SHAPE,
  softBodyOf,
  writeSoft,
} from '../../../sdk-core/src/physics/index.ts';
import { softSettings } from '../../../sdk-core/src/physics/soft.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { body, startModule, startThreaded, type Module } from './module.fixture.ts';
import { FLAT } from './soft.fixture.ts';

const GENERATION = 1 << GENERATION_SHIFT;

/** A pile of boxes and compounds, two in three wanting events, dropped on a floor under a cloth
 *  that wants them too; some thrown up, then some removed: every step's records, words joined,
 *  the poses sorted (a pool's threads list the active bodies in the order they ran). */
function pile(jolt: Module, steps: number) {
  let seed = 42;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(GENERATION, 0, -1, 1), size: [30, 1, 30] });
  for (let i = 1; i <= 40; i++) {
    const b = { ...body(i | GENERATION, 2, 1, 0.2 + next() * 0.2, i % 3 ? FLAG.events : 0) };
    b.position = [next() * 2 - 1, 1 + i * 0.35, next() * 2 - 1];
    const part = { shape: SHAPE.box, size: [0.2, 0.1, 0.2] as const, quaternion: [0, 0, 0, 1] };
    const parts = [0, 1, 2].map((k) => ({ ...part, position: [k * 0.3 - 0.3, 0, 0] }));
    writer.add(i % 5 ? b : { ...b, shape: SHAPE.compound, parts });
  }
  const settings = softSettings({ type: 'cloth', pins: [0, 10, 110, 120] });
  const record = softBodyOf(plane(3, 3, 10, 10), { x: 1, y: 1, z: 1 }, settings);
  const place = {
    id: 50 | GENERATION,
    position: [0, 0.8, 0],
    quaternion: FLAT,
    scale: [1, 1, 1] as const,
  };
  const matter = { friction: 0.5, restitution: 0, gravityScale: 1, linearDamping: 0.05 };
  writeSoft(writer, { ...place, ...matter, settings, record });
  writer.flags(50, FLAG.events);
  jolt.step(writer.take(), 0);
  const out: string[][] = [];
  for (let s = 0; s < steps; s++) {
    if (s === 90) for (let i = 1; i <= 40; i += 7) writer.velocity(i, [0, 8, 1]);
    if (s === 130) for (let i = 2; i <= 40; i += 9) writer.remove(i);
    const count = jolt.step(writer.length ? writer.take() : null, 1 / 60);
    const records = (words: Uint32Array, size: number) =>
      Array.from({ length: words.length / size }, (_, r) =>
        words.subarray(r * size, (r + 1) * size).join(','),
      );
    const poses = records(jolt.poses(count), POSE_WORDS);
    const events = records(jolt.events(), EVENT_WORDS);
    out.push([`${jolt.dropped()}`, ...poses.sort(), '|', ...events]);
  }
  return out;
}

test("a pool's contact records, replayed after the step, give the single thread's events", async () => {
  const budget = { bodies: 64, contactEvents: 256 };
  const alone = pile(await startModule(budget), 240);
  const { jolt, close } = await startThreaded(4, budget);
  try {
    const pooled = pile(jolt, 240);
    const sent = alone.reduce((n, step) => n + step.length - step.indexOf('|') - 1, 0);
    assert.ok(sent > 200, `the pile sends enters and leaves: ${sent}`);
    // Enters and leaves in the order the callbacks ran: a pool runs them in another order.
    const unordered = (steps: string[][]) =>
      steps.map((step) => [
        ...step.slice(0, step.indexOf('|')),
        ...step.slice(step.indexOf('|')).sort(),
      ]);
    assert.deepEqual(unordered(pooled), unordered(alone));
  } finally {
    await close();
  }
});
