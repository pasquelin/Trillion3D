// Page of the R2 proof (`row-turn.gpu.ts`): a view slides across many placements of one primitive
// on Dawn, through the engine's GPU cut with its row pass (`webgpu/row/rowEviction.ts`) — the
// closure stamping each placement's rows, the sort ranking them, the readback bringing the queue —
// and the row cache over a table far smaller than the instances, every page's bytes resident. Beside
// it, the same cut over a table that holds everything. Each frame read back: what it drew, what the
// whole table draws at that pose, the requests it denied, the rows it took back.
import { createGpuDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts'
import { createRowEviction } from '../../../packages/sdk-browser/src/webgpu/row/rowEviction.ts'
import { pageResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import { createGroupClosure } from '../../../packages/sdk-browser/src/page/cut/groupClosure.ts'
import type { GpuCut, GpuSelection } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { animationFrame } from '../kit/frame.ts'
import { rowCacheScene } from './rowCacheScene.ts'
import { ROW_IN_USE } from '../../../packages/sdk-browser/src/webgpu/row/rowEvictSortWgsl.ts'

/** The slide: across `span` placements in `flight` frames, then held still; a table of `table`. */
const TURN = { copies: 64, table: 512, span: 3, flight: 90, hold: 60 }

/** What one frame read back says. */
type TurnFrame = { frame: number; drawn: number[]; reference: number[]; holes: number }

/** Leaf units of `reference` the cut `drawn` covers none of, by placement. */
function holes(
  units: readonly (readonly [number, number])[],
  per: number,
  drawn: number[],
  reference: number[],
) {
  const covered = new Set<number>()
  const unitsOf = (page: number, visit: (unit: number) => void) => {
    for (let u = units[page % per][0]; u < units[page % per][1]; u++)
      visit(Math.floor(page / per) * 1e6 + u)
  }
  for (const page of drawn) unitsOf(page, (unit) => covered.add(unit))
  let missing = 0
  for (const page of reference) unitsOf(page, (unit) => void (covered.has(unit) || missing++))
  return missing
}

export async function runRowTurn(options: typeof TURN = TURN) {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: 'no WebGPU adapter' }
  const { device } = gpu
  const held: { selection?: GpuSelection } = {}
  // A request no free row serves asks the cut for a queue (`rowOrder.ts`).
  const scene = rowCacheScene(options.copies, options.table, () => held.selection?.askEvictions())
  const { rows, sync, packed, roots, placement, pages } = scene
  const host = {
    ...{ map: rows.rowMap, words: sync.rowWords, table: rows },
    frame: () => scene.clock.frame,
    order: sync.followRowOrder,
  }
  const reference = packDagSelection(roots)
  const selection = await createGpuDagSelection(device, packed, {
    rowPass: createRowEviction(host),
  })
  held.selection = selection
  const whole = await createGpuDagSelection(device, reference)
  if (!selection || !whole) return { error: 'GPU_SELECTION_UNAVAILABLE', errors: gpu.errors }
  whole.updateResidency(pageResidency(new Uint8Array(reference.pageCount).fill(1)))
  const closure = createGroupClosure(roots as never, placement, pages, true)
  const units = scene.units,
    per = scene.pagesPer
  const frames: TurnFrame[] = [],
    lastUse = new Map<number, number>(),
    truths = new Map<number, readonly number[]>(),
    taken: { frame: number; page: number }[] = [],
    takenInUse: { frame: number; page: number; used: number }[] = []
  let denied = 0,
    landed: unknown = null
  try {
    const total = options.flight + options.hold
    for (let f = 0; f < total; f++) {
      await animationFrame()
      scene.clock.frame = f + 10
      const frame = scene.clock.frame,
        back = (options.span * Math.min(f, options.flight)) / options.flight
      const uniforms = scene.view(back)
      selection.updateWorlds(packed.worlds)
      reference.worlds.set(packed.worlds)
      whole.updateWorlds(reference.worlds)
      whole.dispatch({ ...uniforms, frame })
      truths.set(frame, (await whole.flush())?.drawablePageIds ?? [])
      // The drawn view's readback, recorded as it lands; then the sync: each row it takes back
      // checked against the uses every landed cut names.
      const cut = selection.peek()
      if (cut && cut !== landed) {
        landed = cut
        record(cut as GpuCut)
      }
      sync.followCut(cut)
      const held = new Set(pages.map((_, page) => page).filter((page) => rows.rowOf(page) >= 0))
      sync.syncRows(false)
      for (const page of held) {
        if (rows.rowOf(page) >= 0) continue
        taken.push({ frame, page })
        const used = lastUse.get(page)
        if (used !== undefined && frame - used < ROW_IN_USE) takenInUse.push({ frame, page, used })
      }
      denied += rows.rowsDenied
      selection.updateResidency(rows.residency, rows.residencyChanges)
      rows.clearResidencyChanges()
      const encoder = device.createCommandEncoder()
      const settle = selection.dispatch({ ...uniforms, frame }, encoder)
      device.queue.submit([encoder.finish()])
      settle?.(true)
    }
  } catch (error) {
    return { error: String(error) + ((error as Error).stack ?? ''), errors: gpu.errors }
  } finally {
    selection.dispose()
    whole.dispose()
  }
  /** A landed cut: what it drew against the whole table's cut, and the pages its lists close over,
   *  used at its frame. */
  function record(cut: GpuCut) {
    const frame = cut.uniforms.frame!,
      drawn = [...(cut.result.drawablePageIds ?? [])].sort((a, b) => a - b),
      reference = [...(truths.get(frame) ?? [])].sort((a, b) => a - b)
    frames.push({ frame, drawn, reference, holes: holes(units, per, drawn, reference) })
    const named = [...drawn, ...cut.result.pageIds, ...(cut.result.aheadPageIds ?? [])]
    closure.closeOver(
      named,
      (page) => void lastUse.set(page, Math.max(lastUse.get(page) ?? 0, frame)),
      undefined,
      true,
    )
  }
  const { court: adapter } = await gpu.fermer()
  return {
    adapter,
    frames,
    denied,
    taken,
    takenInUse,
    flight: options.flight,
    errors: gpu.errors,
  }
}
