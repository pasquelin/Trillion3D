import { floorLog2 } from '../../../../math/src/scalar/integers.ts'
/**
 * Integer values keyed by non-negative integer ids, held only for the ids that carry one: what the
 * cut's per-page state is kept in, so its size follows what the view and the pool hold, never the
 * catalogue. An absent id reads 0; writing 0 removes it.
 *
 * Open addressing with linear probing on two typed arrays, and backward-shift removal, so no
 * tombstone ever lengthens a probe. The table doubles past half full and never holds storage
 * before its first entry. Emptied, it keeps a small table — a set that swings between empty and a
 * few members allocates nothing — and releases a large one, so a burst never stays paid for.
 */
const EMPTY = -1
const MIN_SLOTS = 16

export function createSparseInts() {
  const t: Table = { keys: new Int32Array(0), values: new Int32Array(0), shift: 32, size: 0 }
  const map = {
    get size() {
      return t.size
    },
    /** Bytes of the two tables: what the map holds now, never what the catalogue could. */
    get byteLength() {
      return t.keys.byteLength + t.values.byteLength
    },
    get(key: number) {
      if (!t.size) return 0
      const at = find(t, key)
      return t.keys[at] === key ? t.values[at] : 0
    },
    has: (key: number) => map.get(key) !== 0,
    /** Sets `key` to `value`, removing it at 0; returns the previous value. One probe. */
    set(key: number, value: number) {
      return setKey(t, key, value)
    },
    /** Adds `delta` to `key`'s value; returns the new value. One probe. */
    add(key: number, delta: number) {
      return delta === 0 ? map.get(key) : addKey(t, key, delta)
    },
    /** Visits every entry, in no particular order; `visit` must not write the map. */
    forEach(visit: (key: number, value: number) => void) {
      const { keys, values } = t
      for (let i = 0; i < keys.length; i++) if (keys[i] !== EMPTY) visit(keys[i], values[i])
    },
    /** Empties the map: a small table is kept for the next fill, a large mostly empty one
     *  released, so a scratch map cleared every frame costs its entries, not its peak. */
    clear() {
      if (!t.size) return
      if (t.keys.length > MIN_SLOTS * 4 && t.size * 8 < t.keys.length) return release(t)
      t.keys.fill(EMPTY)
      t.values.fill(0)
      t.size = 0
    },
  }
  return map
}

/** The two tables of a map, the shift its hash takes, and how many entries it holds. */
type Table = { keys: Int32Array; values: Int32Array; shift: number; size: number }

const home = (t: Table, key: number) => Math.imul(key, 0x9e3779b1) >>> t.shift

function find(t: Table, key: number) {
  const { keys } = t
  const mask = keys.length - 1
  let at = home(t, key)
  while (keys[at] !== EMPTY && keys[at] !== key) at = (at + 1) & mask
  return at
}

function allocate(t: Table, slots: number) {
  const oldKeys = t.keys,
    oldValues = t.values
  const keys = (t.keys = new Int32Array(slots).fill(EMPTY))
  const values = (t.values = new Int32Array(slots))
  t.shift = 32 - floorLog2(slots)
  for (let i = 0; i < oldKeys.length; i++)
    if (oldKeys[i] !== EMPTY) {
      const at = find(t, oldKeys[i])
      keys[at] = oldKeys[i]
      values[at] = oldValues[i]
    }
}

/** Removes slot `at` and pulls back the entries its hole would cut off from their home. */
function removeAt(t: Table, at: number) {
  const { keys, values } = t
  const mask = keys.length - 1
  let hole = at,
    next = (at + 1) & mask
  while (keys[next] !== EMPTY) {
    const want = home(t, keys[next])
    // The entry at `next` may move into the hole when its home is not strictly between them.
    if (((next - want) & mask) >= ((next - hole) & mask)) {
      keys[hole] = keys[next]
      values[hole] = values[next]
      hole = next
    }
    next = (next + 1) & mask
  }
  keys[hole] = EMPTY
  values[hole] = 0
  if (--t.size === 0 && keys.length > MIN_SLOTS) release(t)
}

function release(t: Table) {
  t.keys = new Int32Array(0)
  t.values = new Int32Array(0)
  t.shift = 32
  t.size = 0
}

/** The slot `key` sits in, or the free slot it goes to, the table grown for it first. */
function slotFor(t: Table, key: number) {
  if ((t.size + 1) * 2 > t.keys.length) {
    const at = t.keys.length ? find(t, key) : -1
    if (at >= 0 && t.keys[at] === key) return at
    allocate(t, Math.max(MIN_SLOTS, t.keys.length * 2))
  }
  return find(t, key)
}

/** Sets `key` to `value`, removing it at 0; returns the previous value. */
function setKey(t: Table, key: number, value: number) {
  if (value === 0 && !t.size) return 0
  const at = value === 0 ? find(t, key) : slotFor(t, key)
  if (t.keys[at] === key) {
    const previous = t.values[at]
    if (value === 0) removeAt(t, at)
    else t.values[at] = value
    return previous
  }
  if (value === 0) return 0
  t.keys[at] = key
  t.values[at] = value
  t.size++
  return 0
}

/** Adds a non-zero `delta` to `key`'s value; returns the new value. */
function addKey(t: Table, key: number, delta: number) {
  const at = slotFor(t, key)
  if (t.keys[at] !== key) {
    t.keys[at] = key
    t.values[at] = delta
    t.size++
    return delta
  }
  const next = t.values[at] + delta
  if (next === 0) removeAt(t, at)
  else t.values[at] = next
  return next
}

/** A buffer of at least `size` entries, at least twice `list`'s, holding `list`'s first `keep`
 *  entries: a list grown one entry at a time is copied a logarithmic number of times. */
export function grown<T extends Int32Array | Uint32Array | Uint8Array>(
  list: T,
  size: number,
  keep = 0,
): T {
  const next = new (list.constructor as new (length: number) => T)(Math.max(size, list.length * 2))
  if (keep) next.set(list.subarray(0, keep))
  return next
}
