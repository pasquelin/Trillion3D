import type { SelectionUniforms } from '../core/selection.ts'
import { levelCountsWord } from './layout.ts'
import { MAIN_VIEW, noteWhole, stampMatches } from './swap.ts'
import { recutMain, type DagRuntimeState } from './runtimeState.ts'
import { readDagSlot, SlotMapRefused } from './readbackSlot.ts'
import type { MainCut } from './dispatch.ts'

// The landing side of the main view's dispatch (`dispatch.ts`): the readback a slot copied, read
// behind the reads in flight, landed in the chain and adopted when it may be.

/** True when the readback copied last is `next`'s, on the residency and the poses in place. The
 *  cut submitted last is the main view's in the swap (`sameCut`). */
export const readFor = (state: DagRuntimeState, next: SelectionUniforms) =>
  stampMatches(state.readback, next, state)

/** What a slot was copied from: the main cut `serial`, under `captured` and the factor `coarsen`
 *  (`listCap.ts`). */
type MainCopy = { captured: SelectionUniforms; serial: number; coarsen: number }

/** Slot `i`, copied from `copy`, read behind the reads in flight. */
export function readMain(cut: MainCut, i: number, copy: MainCopy) {
  const { state } = cut,
    world = state.worldRevision,
    residency = state.residencyRevision
  state.pending = state.pending
    .catch(() => {})
    .then(async () => {
      try {
        // `dispose` destroyed the buffers: a read queued behind the other slot's maps nothing,
        // since mapping a destroyed buffer is a validation error on the device (#334).
        if (!state.disposed) await adoptMain(cut, i, { ...copy, world, residency })
      } catch (error) {
        // A mapping refused — a device lost says so on its own (`device.lost`) — reads nothing:
        // the next dispatch copies the cut again. Any other error is the engine's: it surfaces.
        state.readback = undefined
        if (!(error instanceof SlotMapRefused)) throw error
      } finally {
        state.mapped[i] = false
      }
    })
}

/** Slot `i` mapped and parsed, landed in the chain, adopted when it may be. */
async function adoptMain(
  { resources, state, chain, scratch }: MainCut,
  i: number,
  read: MainCopy & { world: number; residency: number },
) {
  const { readback, outputBytes, readbackBytes: copied, listCap, device, packed } = resources
  const { listFull } = state
  const { parsed, grown, moved, retried } = await readDagSlot(
    readback[i],
    {
      bytes: copied,
      drawnWordOffset: outputBytes / 4,
      listCap,
      scratch: scratch[i],
      levelsWord: levelCountsWord(listCap),
    },
    {
      limits: device.limits,
      pageCount: packed.pageCount,
      listFull,
      coarse: state.coarse,
      cutFactor: read.coarsen,
    },
    // Every copy lands in the chain, adoptable or not: the next is taken against it. A residency
    // that moved since makes the mask a lie; a pose that moved only makes the cut a frame late, as
    // a camera's.
    (words, parsed, retried) =>
      parsed?.drawablePageIds &&
      chain.land(
        new Uint32Array(words, 0, copied >>> 2),
        listCap,
        parsed.pageIds.length,
        parsed.drawablePageIds.length,
        !retried && read.residency === state.residencyRevision,
      ),
  )
  // A cut past the list: the list grows, or past the device the cut coarsens, and the next
  // dispatch cuts again, rather than hand the host a truncated readout. The factor follows the
  // readouts cut under it alone: one copied before it moved names an older cut.
  if (moved) {
    state.factorMoved = true
    recutMain(resources.swap, state)
  }
  if (grown) state.grow = Math.max(state.grow, grown)
  else if (retried) return
  else if (parsed && read.residency === state.residencyRevision) {
    state.last = { uniforms: read.captured, result: parsed, worldRevision: read.world }
    if (!parsed.truncated) noteWhole(resources.swap, MAIN_VIEW, read.serial)
  } else if (!parsed) state.readback = undefined
}
