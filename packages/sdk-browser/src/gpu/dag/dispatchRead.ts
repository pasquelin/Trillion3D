import type { SelectionUniforms } from '../core/selection.ts'
import { levelCountsWord } from './layout.ts'
import { MAIN_VIEW, noteWhole, stampMatches } from './swap.ts'
import { recutMain, type DagRuntimeState } from './runtimeState.ts'
import { readDagSlot } from './readbackSlot.ts'
import { ReadbackRefused } from '../core/readbackRing.ts'
import { widerFlagShape } from './queueGrowth.ts'
import type { MainCut } from './dispatch.ts'

// The readback side of the main view's dispatch (`dispatch.ts`): a buffer of its ring taken, the
// copy read behind the reads in flight, landed in the chain and adopted when it may be.

/** True when the readback copied last is `next`'s, on the residency and the poses in place. The
 *  cut submitted last is the main view's in the swap (`sameCut`). */
export const readFor = (state: DagRuntimeState, next: SelectionUniforms) =>
  stampMatches(state.readback, next, state)

/** What a main readback was copied from: the cut `serial` under `captured` and the factor
 *  `coarsen` (`listCap.ts`), and — stamped at its submit (`readMain`) — the poses and the
 *  residency in place; `cut`, the main view's it lands in. */
export type MainCopy = {
  cut: MainCut
  captured: SelectionUniforms
  serial: number
  coarsen: number
  world: number
  residency: number
}

/** A copy taken: the ring's buffer (`resources.readbacks`) and what it is copied from. */
export type Copy = { buffer: GPUBuffer; tag: MainCopy }

/** A buffer of the ring for the main cut's lists, copied from the cut `serial` under `captured`
 *  and the factor in place; none when the ring has none. */
export function takeCopy(cut: MainCut, captured: SelectionUniforms, serial = -1): Copy | undefined {
  const { resources, state } = cut,
    tag: MainCopy = { cut, captured, serial, coarsen: state.coarse.factor, world: 0, residency: 0 }
  const buffer = resources.readbacks.take(tag, resources.readbackBytes)
  return buffer && { buffer, tag }
}

/** The copy into `buffer` under `tag`, its encoder submitted: stamped with the poses and the
 *  residency in place, and mapped behind the reads in flight (`chainMain`). */
export function readMain(cut: MainCut, { buffer, tag }: Copy) {
  tag.world = cut.state.worldRevision
  tag.residency = cut.state.residencyRevision
  cut.resources.readbacks.submitted(buffer)
}

/** The main ring's chain (`createReadbackRing`): each read runs behind the reads and growths in
 *  flight (`state.pending`), in the order the copies were submitted. */
export function chainMain(read: () => Promise<void>, { cut: { state } }: MainCopy) {
  state.pending = state.pending
    .catch(() => {})
    .then(async () => {
      try {
        await read()
      } catch (error) {
        // A mapping refused — a device lost says so on its own (`device.lost`) — reads nothing:
        // the next dispatch copies the cut again. Any other error is the engine's: it surfaces.
        state.readback = undefined
        if (!(error instanceof ReadbackRefused)) throw error
      }
    })
}

/** A main readback mapped (the ring's `read`): parsed into the arrays of its turn, landed in the
 *  chain, adopted when it may be. */
export function landMain(range: ArrayBuffer, _staging: GPUBuffer, read: MainCopy) {
  const { cut } = read,
    { resources, state, chain, scratch } = cut
  const { outputBytes, readbackBytes: copied, listCap, device, packed } = resources
  const { listFull } = state
  const { parsed, grown, grownFlags, moved, retried } = readDagSlot(
    range,
    {
      bytes: copied,
      drawnWordOffset: outputBytes / 4,
      listCap,
      scratch: scratch[cut.reads++ % scratch.length],
      levelsWord: levelCountsWord(listCap),
    },
    {
      limits: device.limits,
      heldSlots: resources.heldSlots,
      pageCount: packed.pageCount,
      listFull,
      coarse: state.coarse,
      cutFactor: read.coarsen,
      flags: { shape: resources.flagShape, entryCount: packed.entryCount, full: state.flagsFull },
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
  // A cut that dropped work was not drawn: its queues or lists grow, and it is never adopted.
  if (grownFlags) state.growFlags = widerFlagShape(state.growFlags, grownFlags)
  if (retried) return
  if (parsed && read.residency === state.residencyRevision) {
    state.last = { uniforms: read.captured, result: parsed, worldRevision: read.world }
    if (!parsed.truncated) noteWhole(resources.swap, MAIN_VIEW, read.serial)
  } else if (!parsed) state.readback = undefined
}
