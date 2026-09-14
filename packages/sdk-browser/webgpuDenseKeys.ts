/**
 * Membership over dense integer keys, with the members listed in a typed array sized once. Testing,
 * adding and removing are each a handful of array writes, and nothing is allocated after the set is
 * built — which is what lets the residency path carry a set from one image to the next instead of
 * rebuilding it, and what makes "no page changed" cost nothing at all.
 *
 * A removal swaps the last member into the hole, so the listing order is the caller's history, never
 * a sort. An optional `mirror` array rides along: entry `i` of the mirror belongs to `list[i]`, so a
 * caller can keep the records beside the keys without a second index.
 */
export type DenseKeySet = ReturnType<typeof createDenseKeySet>;

export function createDenseKeySet(capacity: number, mirror?: unknown[]) {
  const size = Math.max(1, capacity);
  const at = new Int32Array(size).fill(-1),
    list = new Int32Array(size);
  let count = 0;
  return {
    list,
    get count() {
      return count;
    },
    has: (key: number) => at[key] >= 0,
    /** Position of `key` in `list`, or -1. */
    indexOf: (key: number) => at[key],
    /** True when the key was not a member yet; `value` fills the mirror entry beside it. */
    add(key: number, value?: unknown) {
      if (at[key] >= 0) return false;
      at[key] = count;
      list[count] = key;
      if (mirror) mirror[count] = value;
      count++;
      if (mirror) mirror.length = count;
      return true;
    },
    /** True when the key was a member; the last member takes its place in `list` and the mirror. */
    remove(key: number) {
      const index = at[key];
      if (index < 0) return false;
      const last = list[--count];
      list[index] = last;
      at[last] = index;
      at[key] = -1;
      if (mirror) {
        mirror[index] = mirror[count];
        mirror.length = count;
      }
      return true;
    },
    clear() {
      for (let i = 0; i < count; i++) at[list[i]] = -1;
      count = 0;
      if (mirror) mirror.length = 0;
    },
  };
}
