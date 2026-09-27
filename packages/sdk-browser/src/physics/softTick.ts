import {
  SOFT_STATE_WORDS,
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';

/**
 * The soft-body vertices of one tick in the physics worker (`SOFT_STATE_WORDS` records): each
 * step's records kept, a body's later record written over its earlier one, so the page hears
 * every body the tick moved once, where its last step left it. The words grow to the tick's size
 * once, and are reused.
 */
export function createSoftTick() {
  return createRecordTick(SOFT_STATE_WORDS, 3);
}

/**
 * The vehicles' state of one tick (`vehicleLayout.ts`): a vehicle at rest is written by the module
 * only as it comes to rest (`vehicles.cpp`), so every step's records are kept, a vehicle's later
 * record written over its earlier one, and the page hears each vehicle the tick wrote once, where
 * its last step left it.
 */
export function createVehicleTick() {
  return createRecordTick(VEHICLE_STATE_WORDS, WHEEL_STATE_WORDS);
}

/** Records of `head` words, `id, count, …`, then `count` items of `item` words: kept by id. */
function createRecordTick(head: number, item: number) {
  let words = new Uint32Array(0),
    length = 0;
  const at = new Map<number, number>();
  return {
    /** Keeps a step's records. */
    gather(fresh: Uint32Array) {
      for (let from = 0; from < fresh.length;) {
        const size = head + fresh[from + 1] * item;
        let to = at.get(fresh[from]);
        if (to === undefined) {
          at.set(fresh[from], (to = length));
          length += size;
          if (length > words.length) {
            const grown = new Uint32Array(Math.max(length, words.length * 2));
            grown.set(words);
            words = grown;
          }
        }
        words.set(fresh.subarray(from, from + size), to);
        from += size;
      }
    },
    /** The tick's records, copied out (`null` when none), and the tick emptied. */
    take() {
      const out = length ? words.slice(0, length) : null;
      length = 0;
      at.clear();
      return out;
    },
  };
}
