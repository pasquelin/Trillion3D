/**
 * The contact scene the threaded module is proved on, in Node (`contactThreads.test.ts`) and in a
 * cross-origin isolated page (`tests/browser/renders/physics-threaded-contacts.browser.ts`): free of
 * Node, it takes any started module.
 */
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
import type { JoltModule } from './joltModule.ts';
import { body, FLAT } from './records.fixture.ts';

const GENERATION = 1 << GENERATION_SHIFT;

/** The pile's budget: its 42 bodies within 64, every step's enters within 256. */
export const PILE_BUDGET = { bodies: 64, contactEvents: 256 };

/** One step of the pile: the enters dropped, the poses sorted (a pool's threads list the active
 *  bodies in the order they ran), the events in the order the module sent them; words joined. */
export interface PileStep {
  dropped: number;
  poses: string[];
  events: string[];
}

/** A pile of boxes and compounds, two in three wanting events, dropped on a floor under a cloth
 *  that wants them too; some thrown up, then some removed. `bound(step)`, when not 0, bounds the
 *  jobs of that step. */
export function pile(jolt: JoltModule, steps: number, bound = (_step: number) => 0): PileStep[] {
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
  const records = (words: Uint32Array, size: number) =>
    Array.from({ length: words.length / size }, (_, r) =>
      words.subarray(r * size, (r + 1) * size).join(','),
    );
  const out: PileStep[] = [];
  for (let s = 0; s < steps; s++) {
    if (s === 90) for (let i = 1; i <= 40; i += 7) writer.velocity(i, [0, 8, 1]);
    if (s === 130) for (let i = 2; i <= 40; i += 9) writer.remove(i);
    const jobs = bound(s);
    if (jobs) jolt.concurrency(jobs);
    const count = jolt.step(writer.length ? writer.take() : null, 1 / 60);
    const poses = records(jolt.poses(count), POSE_WORDS).sort();
    out.push({ dropped: jolt.dropped(), poses, events: records(jolt.events(), EVENT_WORDS) });
  }
  return out;
}

/** The steps with each step's events sorted: what a pool must give as the single thread gives,
 *  since its threads run the contact callbacks in another order. */
export const settled = (steps: PileStep[]) =>
  steps.map((step) => ({ ...step, events: [...step.events].sort() }));

/** Every pair's events over the run, in the order the module sent them (`step:type:impulse`):
 *  an enter before its leave, whatever the other pairs did meanwhile. */
export function pairOrder(steps: PileStep[]) {
  const pairs = new Map<string, string[]>();
  steps.forEach(({ events }, s) =>
    events.forEach((words) => {
      const [type, a, b, impulse] = words.split(',');
      const key = `${a},${b}`;
      let list = pairs.get(key);
      if (!list) pairs.set(key, (list = []));
      list.push(`${s}:${type}:${impulse}`);
    }),
  );
  return Object.fromEntries([...pairs].sort(([x], [y]) => (x < y ? -1 : 1)));
}

/** Enters and leaves the run sent. */
export const eventCount = (steps: PileStep[]) =>
  steps.reduce((n, { events }) => n + events.length, 0);
