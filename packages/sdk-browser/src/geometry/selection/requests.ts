import { resized } from '../../../../math/src/sequence/resized.ts'

/** The request key of a record: its streaming bundle when the cache has one, its own page otherwise. */
export function pageRequestUrl<T extends { url: string; streamUrl?: string }>(rec: T) {
  return rec.streamUrl ?? rec.url
}
/** Number distinct request keys once and for all; returns the rank of each key. A key already
 *  ranked in `byKey` keeps its rank, a new one takes the next: records joining a catalogue later
 *  (`addPlacements`) are ranked behind those it holds, on the table the open made. */
export function indexPageRequests<
  T extends { url: string; streamUrl?: string; requestIndex?: number },
>(pages: readonly T[], byKey = new Map<string, number>()) {
  for (let i = 0; i < pages.length; i++) {
    const key = pageRequestUrl(pages[i])
    let rank = byKey.get(key)
    if (rank === undefined) {
      rank = byKey.size
      byKey.set(key, rank)
    }
    pages[i].requestIndex = rank
  }
  return byKey
}
/**
 * Deduplicate request keys without a hash table: one stamp per rank, reused from one
 * frame to the next. A cut of fifteen thousand pages is walked without allocating or hashing.
 */
export class RequestStamps {
  private stamps: Int32Array
  private current = 0
  constructor(count: number) {
    this.stamps = new Int32Array(Math.max(0, count))
  }
  /** The table holds `count` ranks at least: the new ones unseen, the others as they were. */
  grow(count: number) {
    this.stamps = resized(this.stamps, count)
  }
  /** Open a pass: everything seen before is forgotten. */
  begin() {
    this.current++
  }
  /**
   * Append to `into` the request address of each record of `list`, from `from` to `to`, whose rank
   * has not yet been seen since `begin()`. Dedup and write fit in one loop, on the stamp array read
   * as a field and on `into` ranks written directly: a cut of a hundred thousand records pays no
   * call or a stack frame per record. `missing` keeps only pages without bytes — the list of
   * addresses still awaited.
   */
  mark(
    list: readonly {
      url: string
      streamUrl?: string
      array?: Uint32Array
      requestIndex?: number
    }[],
    into: string[],
    missing = false,
    from = 0,
    to = list.length,
  ) {
    const { stamps, current } = this
    let count = into.length
    for (let i = from; i < to; i++) {
      const rec = list[i],
        index = rec.requestIndex
      if (missing && rec.array) continue
      if (index !== undefined && index >= 0 && index < stamps.length) {
        if (stamps[index] === current) continue
        stamps[index] = current
      }
      into[count++] = pageRequestUrl(rec)
    }
    into.length = count
    return into
  }
}
/**
 * Records grouped by address: the streaming request (`pageRequestUrl`), which a path fetching
 * packed cluster-index bundles reads.
 */
export function indexPagesByUrl<T extends { url: string; streamUrl?: string }>(
  pages: readonly T[],
  /** The map the records join, behind what it holds: a new one at the open. */
  byUrl = new Map<string, T[]>(),
) {
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i],
      key = pageRequestUrl(rec)
    let list = byUrl.get(key)
    if (!list) byUrl.set(key, (list = []))
    list.push(rec)
  }
  return byUrl
}
/** Fallback without stamps: one set for the whole host, cleared on each call. */
const viewsWithoutStamp = new Set<string>()
type Requested = { array?: Uint32Array; url: string; streamUrl?: string; requestIndex?: number }
/**
 * Request addresses of the records still missing bytes, in their order. A request brings its
 * closure: the missing bundles a record's bundle is installed after (`dependencies`,
 * `./bundleDependencies.ts`) are listed just before the record itself, so a parent outside the cut
 * is fetched too, and the records first in the order are not queued behind every other record's
 * dependencies.
 */
export function collectPendingUrls<T extends Requested & { dependencies?: readonly Requested[] }>(
  shown: readonly T[],
  into: string[],
  stamps?: RequestStamps,
) {
  into.length = 0
  if (stamps) {
    stamps.begin()
    // Each record's dependencies just before it; the records between two that have some, one pass.
    let from = 0
    for (let i = 0; i < shown.length; i++) {
      const dependencies = shown[i].dependencies
      if (!dependencies?.length) continue
      stamps.mark(shown, into, true, from, i)
      stamps.mark(dependencies, into, true)
      from = i
    }
    return stamps.mark(shown, into, true, from)
  }
  // Fallback without stamps: a host that has not numbered its requests deduplicates by the strings.
  const seen = viewsWithoutStamp
  seen.clear()
  const add = (rec: Requested) => {
    if (rec.array) return
    const key = pageRequestUrl(rec)
    if (seen.has(key)) return
    seen.add(key)
    into.push(key)
  }
  for (let i = 0; i < shown.length; i++) {
    shown[i].dependencies?.forEach(add)
    add(shown[i])
  }
  return into
}
/** Hand a loaded page or bundle to every record that shares it; a bundled record gets a view at its
 *  own offset, so one request makes dozens of clusters drawable. */
export function acceptPageArray<
  T extends { array?: Uint32Array; indexBytes: number; triangles: number; streamOffset?: number },
>(recs: readonly T[], array: Uint32Array) {
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i],
      offset = rec.streamOffset
    const view =
      offset === undefined ? array : array.subarray(offset / 4, offset / 4 + rec.triangles * 3)
    rec.array = view
    rec.indexBytes = view.byteLength
  }
}
