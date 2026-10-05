import {
  BODY_INDEX,
  EVENT_WORDS,
  MAX_CATCH_UP_STEPS,
  POSE_WORDS,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { JoltModule } from './joltModule.ts';
import type { CharacterReport } from './characterDriver.ts';
import { beforesAt, eventsAt, resultWords, type FromPhysics } from './protocol.ts';
import {
  createFeetTick,
  createSoftTick,
  createVehicleTick,
  noBefore,
  rewriteRecord,
} from './recordTick.ts';

/**
 * One tick's results in the physics worker: the poses and events of every step it takes, written
 * straight into a free result buffer (`buffers`), or into a staging copy while the page holds
 * both; one pose slot per body (a later step overwrites), then the events. A body met again in a
 * later run of the tick keeps its pose of the step before in the same slot from `beforesAt`
 * (`rewriteRecord`): the page draws between a body's last two steps (`poses.ts`); met once, that
 * slot's id word names no body (`noBefore`). The wheels, the soft vertices and the character's
 * feet are kept by the same rule (`recordTick.ts`). Nothing is allocated per pose, and no event is
 * ever cut: the worker steps only while one more step's events fit.
 */
export function createTickResults(
  jolt: JoltModule,
  budget: PhysicsBudget,
  buffers: ArrayBuffer[],
  send: (message: FromPhysics, transfer?: Transferable[]) => void,
) {
  const slotOf = new Int32Array(budget.bodies),
    stamp = new Uint32Array(budget.bodies).fill(0xffffffff),
    befores = beforesAt(budget),
    events = eventsAt(budget);
  const soft = createSoftTick(),
    vehicles = createVehicleTick(),
    feet = createFeetTick();
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
  /** A step's refused shapes, diverged bodies, broken joints and exhausted budgets reach the page
   *  as they happen; the world runs. */
  const report = () => {
    const joints = jolt.broken();
    if (joints.length) send({ type: 'broken', joints });
    // Bodies the module took out alone: the page hears their ids and retires them.
    const leave = (code: string, bodies: number[], what: string) => {
      if (bodies.length)
        send({
          type: 'error',
          code,
          message: `Physics: ${bodies.length} ${what}.`,
          fatal: false,
          bodies,
        });
    };
    leave('PHYSICS_FAILED', jolt.refused(), 'body shape(s) refused by the module');
    leave('PHYSICS_DIVERGED', jolt.diverged(), 'body(ies) went non-finite and left the simulation');
    // Soft bodies the module brought back to a good state stay: the page hears their ids, and counts them.
    const recovered = jolt.recovered();
    if (recovered.length) send({ type: 'recovered', bodies: recovered });
    const now = jolt.overflow().join(', ');
    if (now && now !== overflow) {
      const message = `Physics budget "${now}" exceeded in a step: contacts were missed.`;
      send({ type: 'error', code: 'PHYSICS_BUDGET', message, fatal: false });
    }
    overflow = now;
  };
  return {
    /** Keeps the last run's `count` poses and its events, `stepped` when it took a step. */
    gather(count: number, stepped: boolean) {
      const words = jolt.poses(count),
        to = target();
      // A step sends one record per body (`writePoses`), so a tick's first poses fill its slots in
      // record order: one block copy, and only the slots are stamped.
      if (poseCount === 0) {
        to.set(words);
        for (let r = 0; r < count; r++) {
          const at = r * POSE_WORDS,
            index = words[at] & BODY_INDEX;
          stamp[index] = tick;
          slotOf[index] = r;
          to[befores + at] = noBefore(words[at]);
        }
        poseCount = count;
      } else
        for (let r = 0; r < count; r++) {
          const at = r * POSE_WORDS,
            index = words[at] & BODY_INDEX,
            met = stamp[index] === tick;
          if (!met) [stamp[index], slotOf[index]] = [tick, poseCount++];
          const o = slotOf[index] * POSE_WORDS;
          if (met) rewriteRecord(to, o, to, befores + o, words, at, POSE_WORDS, stepped);
          else {
            to[befores + o] = noBefore(words[at]);
            for (let k = 0; k < POSE_WORDS; k++) to[o + k] = words[at + k];
          }
        }
      const fresh = jolt.events();
      to.set(fresh, events + eventCount * EVENT_WORDS);
      eventCount += fresh.length / EVENT_WORDS;
      dropped += jolt.dropped();
      soft.gather(jolt.soft(), stepped);
      vehicles.gather(jolt.vehicles(), stepped);
      feet.gather(jolt.character(), stepped);
      report();
    },
    /** Whether one more step's events surely fit in the tick's results. */
    room: () => eventCount + budget.contactEvents <= budget.contactEvents * MAX_CATCH_UP_STEPS,
    /** Hands the tick's results to the page, `after` the state the steps left (the bodies
     *  awake, the page's step it stands at, whether it rests), and the command buffers `spent`
     *  since the last results; false while it holds both buffers. */
    post(
      { steps, stepMs, stepMaxMs }: { steps: number; stepMs: number; stepMaxMs: number },
      after: { active: number; step: number; resting: boolean; heard: number },
      character: () => CharacterReport | null,
      spent: ArrayBuffer[],
    ) {
      if (!out || !(poseCount || eventCount || steps)) return false;
      if (!outBuffer) {
        // Staged while the page held both buffers: copied into the first one back.
        outBuffer = buffers.pop() ?? null;
        if (!outBuffer) return false;
        const words = new Uint32Array(outBuffer);
        words.set(out.subarray(0, poseCount * POSE_WORDS));
        words.set(out.subarray(befores, befores + poseCount * POSE_WORDS), befores);
        words.set(out.subarray(events, events + eventCount * EVENT_WORDS), events);
      }
      const counts = { poses: poseCount, events: eventCount, dropped, steps };
      const records = { vehicles: vehicles.take(), soft: soft.take(), feet: feet.take() };
      const message = {
        ...{ ...counts, ...after, ...records, stepMs, stepMaxMs },
        ...{ character: character(), spent: spent.splice(0) },
      };
      // The records are the tick's own copies: moved to the page, never copied again.
      const transfer: Transferable[] = [outBuffer, ...message.spent];
      for (const kind of Object.values(records)) {
        if (kind) transfer.push(kind.words.buffer);
        if (kind?.befores) transfer.push(kind.befores.buffer);
      }
      send({ type: 'results', buffer: outBuffer, ...message }, transfer);
      out = outBuffer = null;
      tick++;
      poseCount = eventCount = dropped = 0;
      return true;
    },
  };
}
