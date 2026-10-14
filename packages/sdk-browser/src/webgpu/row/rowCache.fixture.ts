// The row cache's bench (#1483): `instances` opaque clusters, each at its own address, over a table
// of `slots` visibility rows, the residency mirror and the readbacks driven by hand, and the GPU's
// cut of the rows each frame (`rowGpu`).
import { createWebgpuRowState } from './state.ts'
import { slotTable } from './pageState.fixture.ts'
import { createWebgpuRowSync } from './sync.ts'
import type { InstanceClosure } from './rowDemandState.ts'
import type { IdDelta } from '../cut/delta.ts'
import { ROW_WORDS } from '../../visibility/types.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { pageAddress } from './pageSlots.ts'
import { closeRows } from './rowClosure.fixture.ts'
import { sortPool } from '../../gpu/pool/sort.fixture.ts'
import { poolRank } from '../../gpu/pool/rank.fixture.ts'
import { ROW_IN_USE } from './rowEvictSortWgsl.ts'
import { ROW_BURST } from '../../gpu/dag/readoutWords.ts'
import { ROW_PAGE, ROW_USE, ROW_USE_WORDS } from './rowWords.ts'
import type { WebgpuRowState } from './state.ts'

/** A mirror with nothing to report: the fixtures move residency by hand. */
export const MIRROR = { sync: () => {}, dirty: true }
/** Without group links, an instance closes over itself alone: a counted closure whose difference
 *  is the ids' own. */
export function closeAlone(): InstanceClosure {
  const counts = new Map<number, number>()
  const delta = {
    ...{ entered: new Int32Array(0), exited: new Int32Array(0), enteredCount: 0, exitedCount: 0 },
    has: (id: number) => (counts.get(id) ?? 0) > 0,
  }
  const apply = (cut: IdDelta) => {
    const entered: number[] = [],
      exited: number[] = []
    for (let i = 0; i < cut.enteredCount; i++) {
      const id = cut.entered[i],
        n = counts.get(id) ?? 0
      counts.set(id, n + 1)
      if (!n) entered.push(id)
    }
    for (let i = 0; i < cut.exitedCount; i++) {
      const id = cut.exited[i],
        n = (counts.get(id) ?? 0) - 1
      counts.set(id, n)
      if (!n) exited.push(id)
    }
    Object.assign(delta, {
      ...{ entered: Int32Array.from(entered), exited: Int32Array.from(exited) },
      ...{ enteredCount: entered.length, exitedCount: exited.length },
    })
  }
  return { apply, delta, hostBytes: 0 } as unknown as InstanceClosure
}

/** Each request `k` closes over itself and its group-mate `k + 10`, which it brings in after it. */
export function closePairs(): InstanceClosure {
  const alone = closeAlone(),
    apply = alone.apply.bind(alone)
  const paired = (ids: Int32Array, count: number) =>
    Int32Array.from([...ids.subarray(0, count)].flatMap((id) => [id, id + 10]))
  alone.apply = (cut) => {
    const entered = paired(cut.entered, cut.enteredCount),
      exited = paired(cut.exited, cut.exitedCount)
    apply({ ...cut, entered, exited, enteredCount: entered.length, exitedCount: exited.length })
  }
  return alone
}

/** The frame a bench's clock starts at: past the rows' span in use, so a row no cut stamped is
 *  idle from the first frame. */
const FIRST_FRAME = 100

/**
 * The GPU's cut of the rows at `clock` over `sync`'s table: the host's writes sent to its words,
 * the rows of `seeds` stamped — each page alone, as without groups (`rowClosure.fixture.ts`) —, the
 * live rows ranked (`sortPool`), and the queue followed, as a readback of that cut brings it.
 */
export function rowGpu(sync: ReturnType<typeof createWebgpuRowSync>, rows: WebgpuRowState) {
  let use = new Uint32Array(0)
  return (clock: number, seeds: readonly number[]) => {
    if (use.length < rows.blendFirst * ROW_USE_WORDS) {
      const grown = new Uint32Array(rows.blendFirst * ROW_USE_WORDS)
      grown.set(use)
      use = grown
    }
    sync.rowWords.flush(rows.packedCount, (row, data) => use.set(data, row * ROW_USE_WORDS))
    const stamped = seeds.map((page) => ({ page, placement: 0, value: clock }))
    closeRows(stamped, [{ pageBase: 0 }], rows.rowOf, use)
    const age = (j: number) => clock - Math.min(use[j * ROW_USE_WORDS + ROW_USE], clock)
    const ranked = sortPool(rows.packedCount, (j) => poolRank(age(j), 0, ROW_IN_USE), ROW_BURST)
    const pages = Uint32Array.from(ranked.queue, (j) => use[j * ROW_USE_WORDS + ROW_PAGE])
    sync.followRowOrder(pages, ranked.total, clock)
  }
}

export function rowCache(instances: number, slots: number) {
  const pages = Array.from(
    { length: instances },
    (_, id) =>
      ({
        id,
        url: `p/${id}`,
        array: Uint32Array.of(0, 1, 2),
        attributes: { position: {} },
        transparent: false,
        depthLayer: 0,
      }) as unknown as PageRec,
  )
  const resident = slotTable()
  const rows = createWebgpuRowState(pages, slots, 0, undefined, resident.read)
  rows.pageTableFloats = new Float32Array(slots * ROW_WORDS)
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer)
  // A row names its instance, one past it, where the GPU would read the record.
  const writer = (
    _rec: PageRec,
    page: number,
    row: number,
    _offset: number,
    _floats: Float32Array,
    ints: Uint32Array,
  ) => void (ints[row * ROW_WORDS] = page + 1)
  let clock = FIRST_FRAME
  const sync = createWebgpuRowSync(
    rows,
    MIRROR,
    pages,
    () => true,
    writer,
    closeAlone,
    undefined,
    undefined,
    undefined,
    () => clock,
  )
  const gpu = rowGpu(sync, rows)
  /** The lists of the cut the view stands on: each frame's GPU cut stamps their rows. */
  let seeds: number[] = []
  /** The instances `ids` take their bytes (`offset` a slot) or give them back (-1). */
  const land = (ids: Iterable<number>, offset = 16) => {
    for (const page of ids) {
      resident.set(pageAddress(pages[page]), offset < 0 ? -1 : page * offset)
      rows.touchPage(page)
    }
  }
  /** One readback adopted: what its cut drew, and what it asks for in its order — the cut's
   *  stamps and queue first, as the GPU lays them before the host reads its lists. `cut`, the
   *  cut's whole lists, which the GPU stamps, when the host adopted only their head (a truncated
   *  readback): `drawn` and `asked` then. */
  const readback = (
    drawn: number[],
    asked: number[],
    cut: { drawn: number[]; asked: number[] } = { drawn, asked },
  ) => {
    seeds = [...cut.drawn, ...cut.asked]
    gpu(clock, seeds)
    sync.followCut({ result: { pageIds: asked } })
  }
  /** One image: the sync, its time budget lifted, then the frame's GPU cut on the lists in hand. */
  const frame = () => {
    clock++
    const passed = sync.syncRows(false)
    gpu(clock, seeds)
    return passed
  }
  /** The instances holding a row, ascending. */
  const held = () =>
    Array.from(rows.packedPageIndex.subarray(0, rows.packedCount)).sort((a, b) => a - b)
  return { rows, sync, land, readback, frame, held }
}

/** `0, 1, …, count - 1`. */
export const range = (count: number, from = 0) => Array.from({ length: count }, (_, i) => from + i)
