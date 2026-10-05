/**
 * The contact scene the threaded module is proved on (`contactThreads.test.ts`): it takes any
 * started module. Its merged records come in the engine's canonical pair-key order (`contacts.cpp`,
 * route (b), the boss's yes of 29 Sept.), not the module's callback order; a removed body's leaves
 * come before that merge and a cloth's after it.
 */
import {
  PHYSICS_STEP,
  CommandWriter,
  EVENT_WORDS,
  FLAG,
  POSE_WORDS,
  SHAPE,
  softBodyOf,
  writeSoft,
} from '../../../sdk-core/src/physics/index.ts';
import { softSettings } from '../../../sdk-core/src/physics/softSettings.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import type { JoltModule } from './joltModule.ts';
import { body, FLAT, id } from './records.fixture.ts';

/** The pile's budget: its 42 bodies within 64, every step's enters within 256, in 64 MB. */
export const PILE_BUDGET = { bodies: 64, contactEvents: 256, memoryBytes: 64 << 20 };

/** One step of the pile: the enters dropped, the poses sorted (a pool's threads list the active
 *  bodies in the order they ran), the events, in the order above; words joined. */
export interface PileStep {
  dropped: number;
  poses: string[];
  events: string[];
}

/** What the pile holds: its cloth, whose soft-body pairs write their own leaves after the merge,
 *  and its two later steps (boxes thrown up, then some removed), the removals writing leaves before
 *  it. Both, unless told otherwise: a pile without them has only the records the threads merge, so
 *  its whole buffer is canonical. */
interface PileScene {
  cloth?: boolean;
  changes?: boolean;
}

/** A pile of boxes and compounds, two in three wanting events, dropped on a floor under a cloth
 *  that wants them too; some thrown up, then some removed. `bound(step)`, when given and not 0,
 *  bounds the jobs of that step. `scene` leaves the cloth or the two later steps out. */
export function pile(
  jolt: JoltModule,
  steps: number,
  bound?: (step: number) => number,
  scene: PileScene = {},
): PileStep[] {
  const { cloth = true, changes = true } = scene;
  let seed = 42;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(id(0), 0, -1, 1), size: [30, 1, 30] });
  for (let i = 1; i <= 40; i++) {
    const b = body(id(i), 2, 1, 0.2 + next() * 0.2, i % 3 ? FLAG.events : 0);
    b.position = [next() * 2 - 1, 1 + i * 0.35, next() * 2 - 1];
    const part = { shape: SHAPE.box, size: [0.2, 0.1, 0.2] as const, quaternion: [0, 0, 0, 1] };
    const parts = [0, 1, 2].map((k) => ({ ...part, position: [k * 0.3 - 0.3, 0, 0] }));
    writer.add(i % 5 ? b : { ...b, shape: SHAPE.compound, parts });
  }
  if (cloth) {
    const settings = softSettings({ type: 'cloth', pins: [0, 10, 110, 120] });
    const record = softBodyOf(plane(3, 3, 10, 10), { x: 1, y: 1, z: 1 }, settings, PHYSICS_STEP);
    const place = {
      id: id(50),
      position: [0, 0.8, 0],
      quaternion: FLAT,
      scale: [1, 1, 1] as const,
    };
    const matter = { friction: 0.5, restitution: 0, gravityScale: 1, linearDamping: 0.05 };
    writeSoft(writer, { ...place, ...matter, settings, record });
    writer.flags(50, FLAG.events);
  }
  jolt.step(writer.take(), 0);
  const records = (words: Uint32Array, size: number) =>
    Array.from({ length: words.length / size }, (_, r) =>
      words.subarray(r * size, (r + 1) * size).join(','),
    );
  const out: PileStep[] = [];
  for (let s = 0; s < steps; s++) {
    if (changes && s === 90) for (let i = 1; i <= 40; i += 7) writer.velocity(i, [0, 8, 1]);
    if (changes && s === 130) for (let i = 2; i <= 40; i += 9) writer.remove(i);
    const jobs = bound?.(s);
    if (jobs) jolt.concurrency(jobs);
    const count = jolt.step(writer.length ? writer.take() : null, 1 / 60);
    const poses = records(jolt.poses(count), POSE_WORDS).sort();
    out.push({ dropped: jolt.dropped(), poses, events: records(jolt.events(), EVENT_WORDS) });
  }
  return out;
}

/** `steps` with the events of their first step that reversal changes reversed: a run the single
 *  thread's order must tell apart from its own. */
export function reversedStep(steps: PileStep[]) {
  const s = steps.findIndex(({ events }) => events.join() !== [...events].reverse().join());
  if (s < 0) throw new Error('no step sends its events in an order reversal changes');
  return steps.map((step, i) => (i === s ? { ...step, events: [...step.events].reverse() } : step));
}

/** Enters and leaves the run sent. */
export const eventCount = (steps: PileStep[]) =>
  steps.reduce((n, { events }) => n + events.length, 0);
