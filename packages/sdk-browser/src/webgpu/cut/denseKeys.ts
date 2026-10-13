import { createSparseInts } from '../../page/cut/sparseInts.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'

/**
 * Membership over integer keys, with the members listed densely in a typed array. Testing, adding
 * and removing are each a lookup and a handful of array writes — which is what lets the residency
 * path carry a set from one image to the next instead of rebuilding it, and what makes "no page
 * changed" cost nothing at all.
 *
 * Both tables follow the members, never the key range: the rank of a member is held
 * in a sparse map (`../../page/cut/sparseInts.ts`), and the list doubles when it fills. `list` is
 * therefore read through the set each time, never kept.
 *
 * A removal swaps the last member into the hole, so the listing order is the caller's history, never
 * a sort. An optional `mirror` array rides along: entry `i` of the mirror belongs to `list[i]`, so a
 * caller can keep the records beside the keys without a second index.
 */
export type DenseKeySet = ReturnType<typeof createDenseKeySet>

export function createDenseKeySet(mirror?: unknown[]) {
  /** Member rank plus one: an absent key reads 0. */
  const rank = createSparseInts()
  let list = new Int32Array(8),
    count = 0
  return {
    get list() {
      return list
    },
    get count() {
      return count
    },
    /** Bytes of the rank map and the list. */
    get byteLength() {
      return rank.byteLength + list.byteLength
    },
    has: (key: number) => rank.get(key) !== 0,
    /** Where `key` stands in `list`, -1 when it is no member: the place a `remove` fills with the
     *  last member. */
    indexOf: (key: number) => rank.get(key) - 1,
    /** True when the key was not a member yet; `value` fills the mirror entry beside it. */
    add(key: number, value?: unknown) {
      if (rank.get(key) !== 0) return false
      if (count === list.length) list = resized(list, count + 1)
      rank.set(key, count + 1)
      list[count] = key
      if (mirror) mirror[count] = value
      count++
      if (mirror) mirror.length = count
      return true
    },
    /** True when the key was a member; the last member takes its place in `list` and the mirror. */
    remove(key: number) {
      const index = rank.set(key, 0) - 1
      if (index < 0) return false
      const last = list[--count]
      if (index !== count) {
        list[index] = last
        rank.set(last, index + 1)
      }
      if (mirror) {
        mirror[index] = mirror[count]
        mirror.length = count
      }
      return true
    },
    clear() {
      rank.clear()
      count = 0
      if (mirror) mirror.length = 0
    },
  }
}

/** Keys listed once each, handed out increasing (`takeSorted`): the moved placements, the tree
 *  nodes a refit rewrote, the card records written. */
export type SortedKeys = { listed: DenseKeySet; sorted: Int32Array }

export const createSortedKeys = (): SortedKeys => ({
  listed: createDenseKeySet(),
  sorted: new Int32Array(8),
})

/** The keys listed since the last take, increasing, the list emptied: a view the next take
 *  overwrites. */
export function takeSorted(keys: SortedKeys) {
  const { list, count } = keys.listed
  keys.sorted = resized(keys.sorted, count)
  const ranks = keys.sorted.subarray(0, count)
  ranks.set(list.subarray(0, count))
  ranks.sort()
  keys.listed.clear()
  return ranks
}

/** Keys listed densely for a GPU list read a thread a key, with the places of the list written
 *  since it last went up: the composition's roots and rows (`../../placement/composedRowInputs.ts`),
 *  the placement tree's members drawn whatever the view (`../../gpu/dag/placementTree.ts`). */
export type MirroredKeys = { set: DenseKeySet; moves: SortedKeys }

export const createMirroredKeys = (): MirroredKeys => ({
  set: createDenseKeySet(),
  moves: createSortedKeys(),
})

/** `key` in `keys` or out of it, as `inside` says: the places of the list it wrote are noted. A
 *  removal fills its place with the last key. */
export function mirrorKey(keys: MirroredKeys, key: number, inside: boolean) {
  const { set, moves } = keys
  if (inside) {
    if (set.add(key)) moves.listed.add(set.count - 1)
    return
  }
  const at = set.indexOf(key)
  if (at < 0) return
  set.remove(key)
  if (at < set.count) moves.listed.add(at)
}

/** The places of `keys`' list written since the last take that the list still holds, increasing:
 *  a view the next take overwrites. */
export function takeMirrored(keys: MirroredKeys) {
  const sorted = takeSorted(keys.moves)
  let held = sorted.length
  while (held && sorted[held - 1] >= keys.set.count) held--
  return sorted.subarray(0, held)
}

/** `keys`' list as words, the source a run writer sends the places of (`writeRanges`). */
export const mirroredWords = ({ set }: MirroredKeys) =>
  new Uint32Array(set.list.buffer, set.list.byteOffset, set.list.length)
