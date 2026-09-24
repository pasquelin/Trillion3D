import {
  BODY_INDEX,
  EVENT_WORDS,
  MAX_CATCH_UP_STEPS,
  PHYSICS_STEP,
  POSE_WORDS,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { JoltModule } from './joltModule.ts';
import type { CharacterReport } from './characterDriver.ts';
import { eventsAt, resultWords, type FromPhysics } from './protocol.ts';

/**
 * One tick's results in the physics worker: the poses and events of every step it takes, written
 * straight into a free result buffer (`buffers`), or into a staging copy while the page holds
 * both; one pose slot per body (a later step overwrites), then the events. Nothing is allocated per
 * record, and no event is ever cut: the worker steps only while one more step's events fit.
 */
export function createTickResults(
  jolt: JoltModule,
  budget: PhysicsBudget,
  buffers: ArrayBuffer[],
  send: (message: FromPhysics, transfer?: Transferable[]) => void,
) {
  const slotOf = new Int32Array(budget.bodies),
    stamp = new Uint32Array(budget.bodies).fill(0xffffffff),
    events = eventsAt(budget);
  let out: Uint32Array | null = null,
    outBuffer: ArrayBuffer | null = null,
    staging: Uint32Array | null = null;
  let tick = 0,
    poseCount = 0,
    eventCount = 0,
    dropped = 0,
    overflow = '';
  const target = () => {
    if (out) return out;
    outBuffer = buffers.pop() ?? null;
    out = outBuffer
      ? new Uint32Array(outBuffer)
      : (staging ??= new Uint32Array(resultWords(budget)));
    return out;
  };
  /** A step's refused shapes and exhausted budgets reach the page as they happen; the world runs. */
  const report = () => {
    const bodies = jolt.refused();
    if (bodies.length) {
      const message = `Physics: ${bodies.length} body shape(s) refused by the module.`;
      send({ type: 'error', code: 'PHYSICS_FAILED', message, fatal: false, bodies });
    }
    const now = jolt.overflow().join(', ');
    if (now && now !== overflow) {
      const message = `Physics budget "${now}" exceeded in a step: contacts were missed.`;
      send({ type: 'error', code: 'PHYSICS_BUDGET', message, fatal: false });
    }
    overflow = now;
  };
  return {
    /** Keeps the last step's `count` poses and its events. */
    gather(count: number) {
      const words = jolt.poses(count),
        to = target();
      for (let r = 0; r < count; r++) {
        const at = r * POSE_WORDS,
          index = words[at] & BODY_INDEX;
        if (stamp[index] !== tick) {
          stamp[index] = tick;
          slotOf[index] = poseCount++;
        }
        const o = slotOf[index] * POSE_WORDS;
        for (let k = 0; k < POSE_WORDS; k++) to[o + k] = words[at + k];
      }
      const fresh = jolt.events();
      to.set(fresh, events + eventCount * EVENT_WORDS);
      eventCount += fresh.length / EVENT_WORDS;
      dropped += jolt.dropped();
      report();
    },
    /** Whether one more step's events surely fit in the tick's results. */
    room: () => eventCount + budget.contactEvents <= budget.contactEvents * MAX_CATCH_UP_STEPS,
    /** Hands the tick's results to the page; false while it holds both buffers. */
    post(steps: number, stepMs: number, active: number, character: () => CharacterReport | null) {
      if (!out || !(poseCount || eventCount || steps)) return false;
      if (!outBuffer) {
        // Staged while the page held both buffers: copied into the first one back.
        outBuffer = buffers.pop() ?? null;
        if (!outBuffer) return false;
        const words = new Uint32Array(outBuffer);
        words.set(out.subarray(0, poseCount * POSE_WORDS));
        words.set(out.subarray(events, events + eventCount * EVENT_WORDS), events);
      }
      const counts = { poses: poseCount, events: eventCount, dropped, steps };
      const message = {
        ...counts,
        seconds: steps * PHYSICS_STEP,
        stepMs,
        active,
        character: character(),
      };
      send({ type: 'results', buffer: outBuffer, ...message }, [outBuffer]);
      out = outBuffer = null;
      tick++;
      poseCount = eventCount = dropped = 0;
      return true;
    },
  };
}
