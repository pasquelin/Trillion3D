import type { PageRec } from '../../page/selection/selection.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { castsBlendShadow } from '../../gpu/shadow/transmittance.ts'
import { ROW_BLEND_COVERAGE_WORD, ROW_INDEX_WORDS, ROW_TRANSMISSION_WORD } from './pageRow.ts'
import type { createPageRowWriter } from './pageRowWriter.ts'
import type { createWebgpuRowState } from './state.ts'
import { awaitsPageBytes } from './pageSlots.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'

type Rows = ReturnType<typeof createWebgpuRowState>
type Writer = ReturnType<typeof createPageRowWriter>
const ROW_WORDS = PAGE_INFO_STRIDE / 4

/**
 * The shadow casters of the blended clusters, WITHOUT a visibility row.
 *
 * A blended cluster is drawn in source order by the blend pass, never into the visibility buffer,
 * so it claims no rank of `[0, drawSlots)`. To cast, it takes a row of `[drawSlots, casterSlots)`
 * (`state.ts`), written by the same writer as any row (`pageRowWriter.ts`): the same page-table
 * record, sphere, mobility word and dirty mark, which the shadow cull and the shadow raster read
 * like any caster's. No visibility pass reads past `packedCount`, and no table of theirs changes.
 *
 * A row follows residency, as a visibility row does: taken when the cluster's slot arrives, written
 * again when it moves, given back when it leaves. The whole set is written again when the table's
 * age moves — a pose or a material rewritten by the host — or the table itself is new (a lost
 * device). The pool bounds the rows: `blendSlots` covers every placement it can hold at once.
 * A table grown in place (`grow.ts`) moves the casters' rows behind its new visibility rows: every
 * caster gives its row back and takes one of the new range.
 *
 * A row the host's rewrite of a surface takes, gives back or writes with another coverage calls
 * `onCoverageChange`: the shadow pages under the cluster no longer describe it. A row that follows
 * residency need not, since residency itself restales them.
 */
export function createBlendCasterRows(
  rows: Rows,
  packedPages: PageList,
  writePageRow: Writer,
  onCoverageChange: (rec: PageRec, page: number) => void = () => {},
) {
  const c: Casters = {
    ...{ rows, writePageRow, onCoverageChange },
    /** A packed rank back to its record: the one catalogue accessor
     *  (`../pages/prepare/catalogue.ts`). */
    recordOf: createPageCatalogue(packedPages).recordOf,
    ...{ first: -1, free: new Int32Array(0), freeCount: 0, short: 0 },
    waiting: new Uint8Array(packedPages.length),
    ...{ table: undefined, epoch: -1 },
  }
  seat(c)
  return {
    follow: (page: number, restale = false) => follow(c, page, restale),
    /** Writes every row again when the table is new or its age moved; nothing otherwise. */
    refresh() {
      if (c.table === rows.pageTableFloats && c.epoch === rows.tableEpoch) return
      followTable(c)
      // The same table at another age: the host rewrote a pose or a surface.
      const restale = c.table === rows.pageTableFloats
      c.table = rows.pageTableFloats
      c.epoch = rows.tableEpoch
      if (!c.free.length) return
      for (let page = 0; page < packedPages.length; page++) follow(c, page, restale)
    },
    /** Caster rows in use: what a list of casters can hold beyond the visibility rows. */
    get used() {
      return c.free.length - c.freeCount
    },
    /** Caster rows asked: those in use and those that found none (`followCutRows`). */
    get asked() {
      return this.used + c.short
    },
  }
}

type Casters = {
  rows: Rows
  writePageRow: Writer
  onCoverageChange: (rec: PageRec, page: number) => void
  recordOf: ReturnType<typeof createPageCatalogue>['recordOf']
  first: number
  free: Int32Array
  freeCount: number
  /** Casters that found no row, each once: what the table grows by. */
  short: number
  /** Casters waiting for a row, counted once however often they are followed (`short`). */
  waiting: Uint8Array
  table: Float32Array | undefined
  epoch: number
}

/** The rows `[blendFirst, casterSlots)` of the table as it stands, all free; a caster that held
 *  one of a smaller table gives it back. */
function seat(c: Casters) {
  const { rows } = c
  const held = c.first >= 0
  const first = (c.first = rows.blendFirst)
  c.free = new Int32Array(rows.casterSlots - first)
  c.freeCount = 0
  c.short = 0
  c.waiting.fill(0)
  // Popped from the end: the lowest row first.
  for (let row = rows.casterSlots - 1; row >= first; row--) c.free[c.freeCount++] = row
  if (held)
    for (let page = 0; page < rows.blendRowOf.length; page++)
      if (rows.blendRowOf[page] >= 0) rows.blendRowOf[page] = -1
}

/** Seats the rows again when the table grew since: before any row is taken or written. */
function followTable(c: Casters) {
  if (c.first !== c.rows.blendFirst || c.free.length !== c.rows.casterSlots - c.first) seat(c)
}

function write(c: Casters, page: number, row: number, held: boolean) {
  const { rows } = c
  const rec = c.recordOf(page)!,
    ints = rows.pageTableInts!,
    coverage = row * ROW_WORDS + ROW_BLEND_COVERAGE_WORD,
    before = ints[coverage],
    wasTransmissive = rows.pageTableFloats![row * ROW_WORDS + ROW_TRANSMISSION_WORD] > 0
  rows.packedRecs[row] = rec
  rows.packedPageIndex[row] = page
  const offsetWords = rows.residentOffsetWords[page]
  c.writePageRow(rec, page, row, offsetWords, rows.pageTableFloats!, ints)
  if (held && (ints[coverage] !== before || wasTransmissive || rec.material.transmission > 0))
    c.onCoverageChange(rec, page)
}

function release(c: Casters, page: number, row: number) {
  const { rows } = c
  rows.blendRowOf[page] = -1
  rows.packedRecs[row] = undefined
  // A list built before the release may still name the row: it then draws no corner.
  rows.pageTableInts![row * ROW_WORDS + ROW_INDEX_WORDS] = 0
  rows.markRowDirty(row)
  c.free[c.freeCount++] = row
}

/**
 * Page `page`'s slot moved, arrived or left: its caster row follows. `restale` when the host
 * rewrote the surface, whose shadow then changes with its row — taken, given back or rewritten.
 */
function follow(c: Casters, page: number, restale: boolean) {
  const { rows } = c
  const rec = c.recordOf(page)!
  if (!rec.transparent || !rows.pageTableInts) return
  followTable(c)
  const row = rows.blendRowOf[page]
  if (c.waiting[page]) {
    c.waiting[page] = 0
    c.short--
  }
  // A cluster drawn from its geometry page holds no index page: its slot is all it needs.
  const casts =
    rows.residentOffsetWords[page] >= 0 &&
    !awaitsPageBytes(rec) &&
    (castsBlendShadow(rec.material) || !!rec.deformationOutput)
  if (!casts) {
    if (row < 0) return
    release(c, page, row)
    if (restale) c.onCoverageChange(rec, page)
    return
  }
  if (row >= 0) return write(c, page, row, restale)
  // Empty only past the rows the view holds (#1232): the table grows by the casters left out.
  if (!c.freeCount) {
    c.waiting[page] = 1
    c.short++
    return
  }
  const taken = c.free[--c.freeCount]
  rows.blendRowOf[page] = taken
  write(c, page, taken, false)
  if (restale) c.onCoverageChange(rec, page)
}
