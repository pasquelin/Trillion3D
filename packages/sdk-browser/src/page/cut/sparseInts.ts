/**
 * Integer values keyed by non-negative integer ids, held only for the ids that carry one: what the
 * cut's per-page state is kept in, so its size follows what the view and the pool hold, never the
 * catalogue (#483 rule 6). An absent id reads 0; writing 0 removes it.
 *
 * Open addressing with linear probing on two typed arrays, and backward-shift removal, so no
 * tombstone ever lengthens a probe. The table doubles past half full and never holds storage
 * before its first entry. Emptied, it keeps a small table — a set that swings between empty and a
 * few members allocates nothing — and releases a large one, so a burst never stays paid for.
 */
const EMPTY = -1;
const MIN_SLOTS = 16;

export function createSparseInts() {
  let keys = new Int32Array(0),
    values = new Int32Array(0),
    shift = 32,
    size = 0;
  const home = (key: number) => Math.imul(key, 0x9e3779b1) >>> shift;
  const find = (key: number) => {
    const mask = keys.length - 1;
    let at = home(key);
    while (keys[at] !== EMPTY && keys[at] !== key) at = (at + 1) & mask;
    return at;
  };
  const allocate = (slots: number) => {
    const oldKeys = keys,
      oldValues = values;
    keys = new Int32Array(slots).fill(EMPTY);
    values = new Int32Array(slots);
    shift = 32 - Math.log2(slots);
    for (let i = 0; i < oldKeys.length; i++)
      if (oldKeys[i] !== EMPTY) {
        const at = find(oldKeys[i]);
        keys[at] = oldKeys[i];
        values[at] = oldValues[i];
      }
  };
  /** Removes slot `at` and pulls back the entries its hole would cut off from their home. */
  const removeAt = (at: number) => {
    const mask = keys.length - 1;
    let hole = at,
      next = (at + 1) & mask;
    while (keys[next] !== EMPTY) {
      const want = home(keys[next]);
      // The entry at `next` may move into the hole when its home is not strictly between them.
      if (((next - want) & mask) >= ((next - hole) & mask)) {
        keys[hole] = keys[next];
        values[hole] = values[next];
        hole = next;
      }
      next = (next + 1) & mask;
    }
    keys[hole] = EMPTY;
    values[hole] = 0;
    if (--size === 0 && keys.length > MIN_SLOTS) release();
  };
  const release = () => {
    keys = new Int32Array(0);
    values = new Int32Array(0);
    shift = 32;
    size = 0;
  };
  /** The slot `key` sits in, or the free slot it goes to, the table grown for it first. */
  const slotFor = (key: number) => {
    if ((size + 1) * 2 > keys.length) {
      const at = keys.length ? find(key) : -1;
      if (at >= 0 && keys[at] === key) return at;
      allocate(Math.max(MIN_SLOTS, keys.length * 2));
    }
    return find(key);
  };
  const map = {
    get size() {
      return size;
    },
    /** Bytes of the two tables: what the map holds now, never what the catalogue could. */
    get byteLength() {
      return keys.byteLength + values.byteLength;
    },
    get(key: number) {
      if (!size) return 0;
      const at = find(key);
      return keys[at] === key ? values[at] : 0;
    },
    has: (key: number) => map.get(key) !== 0,
    /** Sets `key` to `value`, removing it at 0; returns the previous value. One probe. */
    set(key: number, value: number) {
      if (value === 0 && !size) return 0;
      const at = value === 0 ? find(key) : slotFor(key);
      if (keys[at] === key) {
        const previous = values[at];
        if (value === 0) removeAt(at);
        else values[at] = value;
        return previous;
      }
      if (value === 0) return 0;
      keys[at] = key;
      values[at] = value;
      size++;
      return 0;
    },
    /** Adds `delta` to `key`'s value; returns the new value. One probe. */
    add(key: number, delta: number) {
      if (delta === 0) return map.get(key);
      const at = slotFor(key);
      if (keys[at] !== key) {
        keys[at] = key;
        values[at] = delta;
        size++;
        return delta;
      }
      const next = values[at] + delta;
      if (next === 0) removeAt(at);
      else values[at] = next;
      return next;
    },
    /** Visits every entry, in no particular order; `visit` must not write the map. */
    forEach(visit: (key: number, value: number) => void) {
      for (let i = 0; i < keys.length; i++) if (keys[i] !== EMPTY) visit(keys[i], values[i]);
    },
    /** Empties the map: a small table is kept for the next fill, a large mostly empty one
     *  released, so a scratch map cleared every frame costs its entries, not its peak. */
    clear() {
      if (!size) return;
      if (keys.length > MIN_SLOTS * 4 && size * 8 < keys.length) return release();
      keys.fill(EMPTY);
      values.fill(0);
      size = 0;
    },
  };
  return map;
}

/** A buffer of at least `size` entries, at least twice `list`'s, holding `list`'s first `keep`
 *  entries: a list grown one entry at a time is copied a logarithmic number of times. */
export function grown(list: Int32Array, size: number, keep = 0) {
  const next = new Int32Array(Math.max(size, list.length * 2));
  if (keep) next.set(list.subarray(0, keep));
  return next;
}
