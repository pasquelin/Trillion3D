import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { askedTableRows, rowScratch } from './layout.ts'
import { grownTableRows, rowsAhead, viewRowsFor } from '../../geometry/rows/tableRows.ts'
import { deviceMade } from '../../gpu/core/errorScope.ts'
import { budgetRefused, ledgerRoom } from '../../gpu/core/deviceLedger.ts'
import { budgetRefusal, deviceRefusal, retryDue, type Refusal } from '../../gpu/core/refusal.ts'
import { pendingAll } from '../../gpu/core/tableGrowth.ts'
import { gpuGrowth } from './growGpuTables.ts'
import { dropRaster } from '../io/drops.ts'
import { queueTableGrowth } from './growthQueue.ts'
import type { TableGrowthReport } from '../../session/memory/pools.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { pagesHeld } from '../../geometry/pages/pool/placement.ts'

/** The rows the tables ask for a pool of `slots` slots — the pages it holds at most
 *  (`pagesHeld`) —, the catalogue as the layout counts it. */
export function tableRowsFor(rt: WebgpuPagesRuntime, slots: number) {
  const { layout, setup } = rt
  const blended = layout.blendedPageCount
  const limits = rt.context.gpuDevice?.limits
  return askedTableRows(
    layout.packedPages.length - blended,
    blended,
    pagesHeld(slots, setup.census.unitPages),
    layout.rows.instances.copiesMax,
    limits,
    layout.viewRows,
  )
}

/**
 * THE CUT CLAIMS ITS ROWS (#1232). The GPU cut asks `asked` rows — the rows the cache holds and
 * the requests it denied (`../../geometry/rows/slots.ts`, `rowsDenied`), or the blended casters' —: past four
 * fifths of the rows the view holds, they rise a quarter above them and the table grows after
 * them, in place, as a larger pool grows it (`growRows`). It is what the view selects that sizes the table,
 * never the placements a scene repeats its pages on, as the visible-cluster list is what its
 * cut emits. Until the growth is granted, the image draws the rows the table holds.
 */
export function followCutRows(rt: WebgpuPagesRuntime, asked: number) {
  // Four fifths of the rows held: the table grows before the cut reaches its end, not after.
  if (5 * asked <= 4 * rt.layout.viewRows) return
  growRows(rt, rt.setup.cap, viewRowsFor(asked)).catch((error) =>
    rt.diag.diagnosticFailure('page-tables-growth-failed', error),
  )
}

/**
 * THE ONE GATE OF EVERY GROWTH OF THE TABLES — the cut's rows (`followCutRows`), a larger
 * geometry pool (`../io/memory.ts`), the roots a growth in place joins
 * (`../../placement/webgpuGrownCut.ts`) —: the tables grown for a pool of `slots` slots, the view
 * holding `viewRows` rows meanwhile. A growth refused waits for its refusal (`rowsRefusal`): the
 * budget's room it lacked, or the device's wait — a refusal is never the view's size for good, nor
 * asked every image —; meanwhile it is refused at once, asking nothing. A growth refused, or one
 * that throws — kept as a device refusal —, gives the rows it asked back: the denials still counted
 * ask it again.
 */
export function growRows(
  rt: WebgpuPagesRuntime,
  slots: number,
  viewRows = rt.layout.viewRows,
): Promise<TableGrowthReport | null> {
  const { layout, run } = rt
  const refused = layout.rowsRefusal
  if (refused && !retryDue(refused, ledgerRoom(rt.gpu.device), run.frame))
    return Promise.resolve(heldReport(rt, 0, 0))
  const held = layout.viewRows
  layout.viewRows = viewRows
  const giveBack = () => {
    if (layout.viewRows === viewRows) layout.viewRows = held
  }
  return queueTableGrowth(rt, () => growTables(rt, slots)).then(
    (report) => {
      if (report?.refused) giveBack()
      return report
    },
    (error: unknown) => {
      giveBack()
      layout.rowsRefusal = deviceRefusal(run.frame, layout.rowsRefusal)
      throw error
    },
  )
}

/**
 * THE TABLES SIZED BY DRAWABLE ROW GROW IN PLACE (#216), when a pool of `slots` slots — a larger
 * geometry pool (`../io/memory.ts`) — or the GPU cut's requests (`followCutRows`) ask more rows
 * than they hold, through their one gate (`growRows`). Nothing is prepared
 * again: no shader, no pipeline, no pool, no texture tile. Every GPU buffer sized by row
 * (`growGpuTables.ts`) is made anew beside the one it replaces, under one out-of-memory scope,
 * while the image goes on drawing from the old ones. Only once the device granted them all are they
 * swapped in, in one step between two images, with the CPU rows (`../../geometry/rows/grow.ts`): every
 * visibility row keeps its rank and its page, so the image the next frame draws is the one it would
 * have drawn, now with room for the pages that waited. A refusal frees what was made and keeps
 * every table and the pool in place, kept as the runtime's refusal and said once an episode
 * (`refuse`, `gpu-out-of-memory`). A lost device grows the CPU rows alone, refusing nothing: the
 * rebuild prepares its GPU tables at their size, and the host's budget holds. Growths wait for a running prepare and for each other, in their order; the report
 * says what the growth cost, or `null` when the tables already held what was asked.
 */
async function growTables(
  rt: WebgpuPagesRuntime,
  slots: number,
): Promise<TableGrowthReport | null> {
  const { layout, setup, gpu, run, diag } = rt,
    { rows } = layout
  const started = cpuNow()
  // What the catalogue needs; when the tables must grow, a growth ahead of it (`rowsAhead`).
  const needed = tableRowsFor(rt, slots),
    grows =
      needed.drawSlots > rows.blendFirst || needed.blendSlots > rows.casterSlots - rows.blendFirst
  const limits = rt.context.gpuDevice?.limits
  const asked = grows ? rowsAhead(limits, needed, rows, layout.viewRows) : needed,
    { drawSlots, casterSlots } = grownTableRows(asked, rows)
  if (drawSlots === rows.blendFirst && casterSlots === rows.casterSlots) {
    setup.cap = Math.max(setup.cap, slots)
    return null
  }
  // A lost device grows the rows alone: the rebuild makes its GPU tables from them.
  const device = run.lost ? undefined : gpu.device
  // What the growth asks: the buffers made, or the whole growth the budget refused.
  let bytes = 0
  // The session's budget refuses as the device does: the tables in place are kept (`budgetRefused`),
  // and asked again once the room the whole growth lacked came back.
  const outcome = device
    ? await deviceMade(device, () => {
        const growth = gpuGrowth(rt, device, drawSlots, casterSlots)
        bytes = growth.bytes
        return growth
      }).catch((error: unknown) => {
        if (!budgetRefused(error)) throw error
        bytes = error.requested
        const room = Number.isFinite(error.shortfall) ? bytes : Infinity
        return { refusal: budgetRefusal(room, run.frame) }
      })
    : pendingAll([])
  if (outcome && 'refusal' in outcome) {
    refuse(rt, bytes, outcome.refusal)
    return heldReport(rt, bytes, msSince(started))
  }
  const granted = outcome
  if (!granted || rt.signal.aborted) {
    granted?.destroy()
    if (!granted) refuse(rt, bytes)
    return heldReport(rt, bytes, msSince(started))
  }
  // Lost while the device was asked: what it granted went with it.
  const lost = run.lost
  if (lost) granted.destroy()
  rows.grow(drawSlots, casterSlots - drawSlots)
  // The open counts the cut's placements hold follow the rows (`../../geometry/dag/queueGrowth.ts`).
  run.gpuSelection?.followRows?.(casterSlots)
  Object.assign(layout, rowScratch(drawSlots, setup.census.clusterBytes))
  if (!lost) {
    granted.commit()
    // The page table, made at preparation (`ensurePageTable`), grew with the others
    // (`gpuGrowth`). The visibility raster goes, its lists sized on the rows.
    dropRaster(rt)
  }
  setup.cap = Math.max(setup.cap, slots)
  layout.rowsRefusal = undefined
  if (asked.bounded)
    diag.engineDiagnostic('page-table-bounded', 'The device bounds the page table', {
      kind: 'warning',
      ...asked.bounded,
    })
  // Origin of the resource change: the tables the image reads were replaced.
  run.gate.resourcesChanged()
  const durationMs = msSince(started)
  const report = { drawSlots, casterSlots, bytes, refused: false, durationMs }
  diag.engineDiagnostic('page-tables-grown', 'Page tables grown in place', report)
  return report
}

/** A growth of `bytes` refused after `durationMs`: the tables keep the rows they hold. */
function heldReport(rt: WebgpuPagesRuntime, bytes: number, durationMs: number) {
  const { blendFirst, casterSlots } = rt.layout.rows
  return { drawSlots: blendFirst, casterSlots, bytes, refused: true, durationMs }
}

/** The growth of `bytes` refused — by the budget (`byBudget`), else by the device —: kept as the
 *  runtime's one refusal of its tables (`rowsRefusal`), said once an episode, at its first. */
function refuse(rt: WebgpuPagesRuntime, bytes: number, byBudget?: Refusal) {
  const { layout, run } = rt
  const first = !layout.rowsRefusal
  layout.rowsRefusal = byBudget ?? deviceRefusal(run.frame, layout.rowsRefusal)
  if (first)
    rt.diag.engineDiagnostic('gpu-out-of-memory', 'The grown page tables were refused', {
      kind: 'warning',
      pool: 'page-tables',
      requestedBytes: bytes,
      grantedBytes: null,
    })
}
