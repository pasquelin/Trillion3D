import { createWebgpuRowJournal } from './journal.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'
import { pageAddress } from './pageSlots.ts'
import { flatInstances, type PackedInstances } from './instances.ts'
import { createDirtyRows } from './dirty.ts'
import { growRowState, widened } from './grow.ts'
/**
 * Stable row and residency arrays shared by the cut, visibility pass, and cache journal.
 *
 * The table holds `drawSlots` visibility rows, then `blendSlots` rows the shadow pass alone reads:
 * the blended clusters that cast (`blendCasters.ts`). A visibility pass reads `[0, packedCount)`
 * and never reaches them; the per-row arrays the shadow pass reads — record, catalogue page,
 * dirty marks — span both. The per-page arrays are replaced when placements grown in place add
 * pages (`addPages`), the per-row ones when the table grows (`grow`): they are read through this
 * object, never kept.
 */
export function createWebgpuRowState(
  packedPages: PageList,
  drawSlots: number,
  blendSlots = 0,
  /** Packed ranks by pool ADDRESS, the key the cache names when a slot moves: the layout's, per
   *  primitive page (`./instances.ts`); made here over a flat list built without one. */
  instances: PackedInstances = flatInstances(packedPages),
) {
  const casterSlots = drawSlots + blendSlots
  const dirtyRows = createDirtyRows(casterSlots)
  const state = {
    /** Pages named by the cache and those whose residency flag just flipped. */
    ...createWebgpuRowJournal(),
    /** First shadow-only row, and the end of the table: `[drawSlots, casterSlots)`. */
    blendFirst: drawSlots,
    casterSlots,
    /** The table's generation: it moves when the table grows, which a reader of its size follows. */
    generation: 0,
    instances,
    /** A record's packed ranks all share its pool address: the address's first rank names it. A
     *  caller that needs ONE instance's rank uses the packed list the cut publishes, never this. */
    pageIndexOf: (rec: PageRec) => instances.first(pageAddress(rec)),
    ...rowArrays(packedPages.length, drawSlots, casterSlots),
    ...rowCounters(),
    /** Declares rows `[from, to]` dirty — one row by default —; `clearDirty` once all are sent. */
    markRowDirty: dirtyRows.mark,
    /** Declares rows dirty whose occupant is kept (a pose, a diagnostic word): `markWords`. */
    markRowWords: dirtyRows.markWords,
    /** Packed page `page`'s readiness moved: its row, if it has one, is written again. */
    markRowOfPage: (page: number) => {
      const row = state.rowOfPage[page]
      if (row >= 0) dirtyRows.markWords(row)
    },
    clearDirty: dirtyRows.clear,
    get dirtyMarks() {
      return dirtyRows.marks
    },
    /** First and last dirty rows: the span that bounds every mark. */
    get dirtyFrom() {
      return dirtyRows.span.from
    },
    get dirtyTo() {
      return dirtyRows.span.to
    },
    /** Row writes since the table was made (`rowsMoved`). */
    get rowWrites() {
      return dirtyRows.writes
    },
    /** The table grows in place to `drawSlots` visibility rows and `blendSlots` casters' rows. */
    grow(drawSlots: number, blendSlots: number) {
      growRowState(state, dirtyRows, drawSlots, blendSlots)
    },
    /** `packedPages` grew from `first` on (`addRowPages`). */
    addPages(first: number) {
      addRowPages(state, packedPages, first)
    },
  }
  return state
}

/** The per-page arrays, over `pages` catalogue pages, and the per-row ones, over `drawSlots`
 *  visibility rows and `casterSlots` rows in all. */
function rowArrays(pages: number, drawSlots: number, casterSlots: number) {
  return {
    /** Per catalogue page, the shadow-only row a blended cluster casts from, or -1. */
    blendRowOf: new Int32Array(pages).fill(-1),
    residentFlags: new Uint32Array(pages),
    residentOffsetWords: new Int32Array(pages).fill(-1),
    rowPageIndex: new Int32Array(drawSlots).fill(-1),
    rowOffsetWords: new Int32Array(drawSlots).fill(-1),
    rowEpoch: new Int32Array(drawSlots),
    packedPageIndex: new Int32Array(casterSlots),
    rowOfPage: new Int32Array(pages).fill(-1),
    packedRecs: new Array<PageRec | undefined>(casterSlots).fill(undefined),
  }
}

/** The table's counters and its page table's arrays, before its first pass. */
function rowCounters() {
  return {
    rowCount: 0,
    tableEpoch: 1,
    rowsEpoch: 0,
    candidateCount: 0,
    /**
     * Age of the row table itself: a new table (prepare, a visibility path dropped) advances it,
     * and the allocator then rebuilds rather than trusting a page → rank mapping it did not post.
     */
    rowsRevision: 0,
    /** Instances the GPU cut asked a row for that the last pass could not give one: neither a
     *  free row nor one unused for a while (`slots.ts`). The table grows by them. */
    rowsDenied: 0,
    packedCount: 0,
    rowsChanged: true,
    pageTableFloats: undefined as Float32Array | undefined,
    pageTableInts: undefined as Uint32Array | undefined,
  }
}

/**
 * `packedPages` grew from `first` on (`../../placement/webgpuGrowth.ts`): `instances` indexes the
 * new roots, and the per-page arrays take the new pages, each with the pool slot the page at its
 * address holds — no residency flag and no row yet —, each named to the journal so the row cache
 * serves it as any arrival.
 */
function addRowPages(state: RowState, packedPages: PageList, first: number) {
  const { instances } = state
  instances.add()
  const n = packedPages.length,
    { recordOf } = createPageCatalogue(packedPages)
  state.residentFlags = widened(state.residentFlags, new Uint32Array(n), 0)
  state.residentOffsetWords = widened(state.residentOffsetWords, new Int32Array(n), -1)
  state.rowOfPage = widened(state.rowOfPage, new Int32Array(n), -1)
  state.blendRowOf = widened(state.blendRowOf, new Int32Array(n), -1)
  for (let page = first; page < n; page++) {
    const sibling = instances.first(pageAddress(recordOf(page)!))!
    state.residentOffsetWords[page] = state.residentOffsetWords[sibling]
    state.touchPage(page)
  }
}

type RowState = ReturnType<typeof createWebgpuRowState>
