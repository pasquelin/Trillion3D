import {
  SOFT_STATE_WORDS,
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import type { TickRecords } from './protocol.ts';

/** The earlier-state word of a record its tick met once: its id word inverted, naming none
 *  (`keptBefore`). */
export const noBefore = (id: number) => ~id;

/**
 * A record of `size` words its tick met again in a later run, `fresh` at `from`, written over its
 * copy at `at` of `words`, beside its state a step before at `beforeAt` of `befores` (the same
 * array may hold both): `stepped`, its copy so far becomes its state a step before; a run of no
 * step (commands run while paused, or before a query) that changed it moved it in place, nothing
 * to draw it over, so the new copy is its step before too; one that left it as it was changes
 * nothing. Every record the worker hands the page — poses (`tickResults.ts`), wheels, soft
 * vertices, the character's feet — is kept by this rule.
 */
export function rewriteRecord(
  words: Uint32Array,
  at: number,
  befores: Uint32Array,
  beforeAt: number,
  fresh: Uint32Array,
  from: number,
  size: number,
  stepped: boolean,
) {
  let moved = stepped;
  if (stepped) for (let k = 0; k < size; k++) befores[beforeAt + k] = words[at + k];
  else for (let k = 0; k < size && !moved; k++) moved = words[at + k] !== fresh[from + k];
  if (moved && !stepped) for (let k = 0; k < size; k++) befores[beforeAt + k] = fresh[from + k];
  for (let k = 0; k < size; k++) words[at + k] = fresh[from + k];
}

/** The soft-body vertices of one tick (`SOFT_STATE_WORDS` records, 3 words a vertex). */
export function createSoftTick() {
  return createRecordTick(SOFT_STATE_WORDS, 3);
}

/**
 * The vehicles' state of one tick (`vehicleLayout.ts`): a vehicle at rest is written by the module
 * only as it comes to rest (`vehicles.cpp`), so the tick holds only the vehicles that moved.
 */
export function createVehicleTick() {
  return createRecordTick(VEHICLE_STATE_WORDS, WHEEL_STATE_WORDS);
}

/** The character's feet of one tick: one record (id 0, one item of 3 words). */
export function createFeetTick() {
  const tick = createRecordTick(2, 3),
    record = Uint32Array.of(0, 1, 0, 0, 0),
    feet = new Float32Array(record.buffer, 8, 3);
  return {
    /** Keeps the feet of a run's character state (`jolt_character`: present, then `x, y, z`),
     *  `stepped` when it took a step; none without a character. */
    gather(state: Float32Array, stepped: boolean) {
      if (!state[0]) return;
      feet.set(state.subarray(1, 4));
      tick.gather(record, stepped);
    },
    take: tick.take,
  };
}

/**
 * The records of one tick in the physics worker, `head` words (`id, count, …`) then `count` items
 * of `item` words: each run's records kept, a record's later copy written over its earlier one
 * by id (`rewriteRecord`), so the page hears every record the tick wrote once, where its last step
 * left it, and, of a record two steps wrote, its copy of the step before beside it
 * (`TickRecords.befores`): the page draws it between its last two steps as it draws the bodies.
 * The words grow to the tick's size once, and are reused.
 */
function createRecordTick(head: number, item: number) {
  let words = new Uint32Array(0),
    befores = new Uint32Array(0),
    length = 0,
    twice = false;
  const at = new Map<number, number>();
  return {
    /** Keeps the records of a run, `stepped` when it took a step. */
    gather(fresh: Uint32Array, stepped: boolean) {
      for (let from = 0; from < fresh.length;) {
        const id = fresh[from],
          size = head + fresh[from + 1] * item;
        let to = at.get(id);
        if (to === undefined) {
          at.set(id, (to = length));
          length += size;
          if (length > words.length) {
            const grown = Math.max(length, words.length * 2);
            const [w, b] = [new Uint32Array(grown), new Uint32Array(grown)];
            w.set(words);
            b.set(befores);
            [words, befores] = [w, b];
          }
          words.set(fresh.subarray(from, from + size), to);
          befores[to] = noBefore(id);
        } else {
          rewriteRecord(words, to, befores, to, fresh, from, size, stepped);
          twice ||= befores[to] === id;
        }
        from += size;
      }
    },
    /** The tick's records, copied out (`null` when none), and the tick emptied. */
    take(): TickRecords | null {
      const out = length
        ? { words: words.slice(0, length), befores: twice ? befores.slice(0, length) : null }
        : null;
      [length, twice] = [0, false];
      at.clear();
      return out;
    },
  };
}
