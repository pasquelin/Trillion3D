import { SOFT_STATE_WORDS } from '../../../sdk-core/src/physics/index.ts';

/**
 * The soft-body vertices of one tick in the physics worker (`SOFT_STATE_WORDS` records): each
 * step's records kept, a body's later record written over its earlier one, so the page hears
 * every body the tick moved once, where its last step left it. The words grow to the tick's size
 * once, and are reused.
 */
export function createSoftTick() {
  let words = new Uint32Array(0),
    length = 0;
  const at = new Map<number, number>();
  return {
    /** Keeps a step's records. */
    gather(fresh: Uint32Array) {
      for (let from = 0; from < fresh.length;) {
        const size = SOFT_STATE_WORDS + fresh[from + 1] * 3;
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
