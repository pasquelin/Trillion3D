import { createSparseInts } from '../../page/cut/sparseInts.ts'
import { keyWordBase, poolBase, recordKeyBase, selectionListCap } from './layout.ts'
import { canonicalPage } from './evict.ts'
import type { PackedDag } from './types.ts'
import type { RangeTarget } from './runWrites.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchGrid, groupWidth } from '../dispatch/grid.ts'
import { POOL_LANES } from '../pool/sortWords.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'

/**
 * What arms the pool sort's per-group stages for the `count` slots the list holds (`DAG_ARGS.pool`):
 * in rows of the device's width, written in the queue's order with the list's count — the GPU's
 * dispatch covers what its count holds, whatever the list does before the submit, and no workgroup
 * past it, where a dispatch over the list's cap ran thousands for nothing.
 */
export function poolSortArming(device: GPUDevice, args: GPUBuffer) {
  const width = groupWidth(device.limits),
    record = new Uint32Array(2)
  return (count: number) => {
    const [x, y] = dispatchGrid(workgroupCount(count, POOL_LANES), width)
    record[0] = x
    record[1] = y
    device.queue.writeBuffer(args, DAG_ARGS.pool, record)
  }
}

/**
 * The keys the pool holds, as the eviction queue sweeps them (`shader/evictWgsl.ts`): a count, then
 * one content key per held slot (`../evict.ts`), fed by the cache's arrivals and departures — named
 * by the key's canonical page — and kept dense — a departure takes the last entry's place —, so the
 * sweep is bounded by the slots, never the catalogue. `note` returns whether the list moved.
 */
export function createDagPoolList(
  packed: PackedDag,
  cold: RangeTarget,
  /** The pages a pool already holds, for a cut made beside it (a growth in place): listed at once,
   *  in one write. */
  held: ((page: number) => boolean) | undefined,
  /** Arms the pool sort for the count the list holds, at each write of it (`poolSortArming`). */
  arm: (count: number) => void,
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
    writes && cold(word * 4, buffer as ArrayBuffer, byteOffset + word * 4, 4 * count)
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
    if (writes) arm(words[base])
    return true
  }
  if (held) {
    writes = false
    // A page is listed for its key alone, the key's canonical page: those are asked, in page order,
    // never the instances.
    const canonical = [
      ...new Set(Array.from({ length: packed.keyCount }, (_, k) => pageOf(k))),
    ].sort((a, b) => a - b)
    for (const page of canonical) if (held(page)) note(page, true)
    writes = true
    write(base, words[base] + 1)
    arm(words[base])
  }
  return { note, entries: entry }
}
