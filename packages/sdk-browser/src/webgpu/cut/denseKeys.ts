import { createSparseInts, grown } from '../../page/cut/sparseInts.ts';

/**
 * Membership over integer keys, with the members listed densely in a typed array. Testing, adding
 * and removing are each a lookup and a handful of array writes — which is what lets the residency
 * path carry a set from one image to the next instead of rebuilding it, and what makes "no page
 * changed" cost nothing at all.
 *
 * Both tables follow the members, never the key range (#483 rule 6): the rank of a member is held
 * in a sparse map (`../../page/cut/sparseInts.ts`), and the list doubles when it fills. `list` is
 * therefore read through the set each time, never kept.
 *
 * A removal swaps the last member into the hole, so the listing order is the caller's history, never
 * a sort. An optional `mirror` array rides along: entry `i` of the mirror belongs to `list[i]`, so a
 * caller can keep the records beside the keys without a second index.
 */
export type DenseKeySet = ReturnType<typeof createDenseKeySet>;

export function createDenseKeySet(mirror?: unknown[]) {
  /** Member rank plus one: an absent key reads 0. */
  const rank = createSparseInts();
  let list = new Int32Array(8),
    count = 0;
  return {
    get list() {
      return list;
    },
    get count() {
      return count;
    },
    /** Bytes of the rank map and the list. */
    get byteLength() {
      return rank.byteLength + list.byteLength;
    },
    has: (key: number) => rank.get(key) !== 0,
    /** True when the key was not a member yet; `value` fills the mirror entry beside it. */
    add(key: number, value?: unknown) {
      if (rank.get(key) !== 0) return false;
      if (count === list.length) list = grown(list, count + 1, count);
      rank.set(key, count + 1);
      list[count] = key;
      if (mirror) mirror[count] = value;
      count++;
      if (mirror) mirror.length = count;
      return true;
    },
    /** True when the key was a member; the last member takes its place in `list` and the mirror. */
    remove(key: number) {
      const index = rank.set(key, 0) - 1;
      if (index < 0) return false;
      const last = list[--count];
      if (index !== count) {
        list[index] = last;
        rank.set(last, index + 1);
      }
      if (mirror) {
        mirror[index] = mirror[count];
        mirror.length = count;
      }
      return true;
    },
    clear() {
      rank.clear();
      count = 0;
      if (mirror) mirror.length = 0;
    },
  };
}
