/** Which classes the image's clusters wear: a count of the resident clusters of each class key, the
 *  keys that hold some, and whether a count came to hold some or to hold none since the keys were
 *  listed. */
export type PresentClasses = {
  counts: Map<number, number>
  keys: number[]
  moved: boolean
  /** Advances every time the keys are listed again: a reader of the keys caches on it. */
  revision: number
}

/** No cluster of any class yet. */
export const createPresentClasses = (): PresentClasses => ({
  counts: new Map(),
  keys: [],
  moved: false,
  revision: 0,
})

/**
 * A resident cluster of class `key` joins the classes (`delta` 1) or leaves them (`delta` -1), as
 * the cluster residency writes or drops its record (`../../geometry/clusters/clusterResidency.ts`):
 * the classes of the clusters in the pool, which are those the image's clusters wear.
 */
export function noteClass(into: PresentClasses, key: number, delta: 1 | -1) {
  const before = into.counts.get(key) ?? 0,
    after = before + delta
  if (after < 0) return
  if (after === 0) into.counts.delete(key)
  else into.counts.set(key, after)
  if (before === 0 || after === 0) into.moved = true
}

/**
 * Classes of the resident clusters, each key listed once, in increasing order. A class the pool has
 * no cluster of is not shaded; a class it has one of, but the image sees none, is shaded over an
 * empty bin, one indirect dispatch that launches no group. The keys are listed again only when a
 * class came or went (`noteClass`); an image over the same classes reuses them.
 */
export function presentClassKeys(into: PresentClasses) {
  if (!into.moved) return into.keys
  into.moved = false
  into.revision++
  into.keys.length = 0
  for (const key of into.counts.keys()) into.keys.push(key)
  into.keys.sort((a, b) => a - b)
  return into.keys
}
