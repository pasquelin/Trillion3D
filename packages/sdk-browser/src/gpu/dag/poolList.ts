import { createSparseInts } from '../../page/cut/sparseInts.ts'
import { keyWordBase, poolBase, recordKeyBase, selectionListCap } from './layout.ts'
import { canonicalPage } from './evict.ts'
import type { PackedDag } from './types.ts'
import { writeParts, type DagParts } from './split.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'

/**
 * The keys the pool holds, as the eviction queue sweeps them (`shader/evictWgsl.ts`): a count, then
 * one content key per held slot (`../evict.ts`), fed by the cache's arrivals and departures — named
 * by the key's canonical page — and kept dense — a departure takes the last entry's place —, so the
 * sweep is bounded by the slots, never the catalogue. `note` returns whether the list moved.
 */
export function createDagPoolList(
  device: GPUDevice,
  packed: PackedDag,
  pageCones: DagParts,
  /** The pages a pool already holds, for a cut made beside it (a growth in place): listed at once,
   *  in one write. */
  held?: (page: number) => boolean,
) {
  const { buffer, byteOffset, length } = packed.pageCones,
    words = new Uint32Array(buffer, byteOffset, length),
    base = poolBase(packed.pageCount),
    [recordKeys, keyWords] = [recordKeyBase(packed.pageCount), keyWordBase(packed)]
  /** Page `page`'s content key, read through its record (`layout.ts`), and key `k`'s page. */
  const keyOf = (page: number) =>
      words[recordKeys + ((page + packed.recordShift[rootOfPacked(packed.pageIndex, page)]) >>> 0)],
    pageOf = (k: number) => canonicalPage(words[keyWords + k])
  /** Each listed page's entry, 1 for the first. */
  const entry = createSparseInts()
  let writes = true
  const write = (word: number, count = 1) =>
    writes &&
    writeParts(device, pageCones, word * 4, buffer as ArrayBuffer, byteOffset + word * 4, 4 * count)
  const note = (page: number, held: boolean) => {
    const key = keyOf(page)
    if (pageOf(key) !== page || entry.has(page) === held) return false
    if (held && words[base] >= selectionListCap(packed.pageCount)) return false
    const at = held ? ++words[base] : entry.set(page, 0),
      moved = held ? key : words[base + words[base]--]
    if (pageOf(moved) !== page || held) entry.set(pageOf(moved), at)
    words[base + at] = moved
    write(base + at)
    write(base)
    return true
  }
  if (held) {
    writes = false
    for (let page = 0; page < packed.pageCount; page++) if (held(page)) note(page, true)
    writes = true
    write(base, words[base] + 1)
  }
  return { note, entries: entry }
}
