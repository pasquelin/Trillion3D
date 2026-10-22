import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import { MAIN_VIEW, noteWhole, stampMatches } from './swap/swap.ts'
import type { DagRuntimeState } from './runtime/runtimeState.ts'
import { readDagSlot } from './readbackSlot.ts'
import { unlessRefused } from '../../gpu/core/readbackRing.ts'
import { behind } from '../../gpu/core/behind.ts'
import type { MainCut } from './dispatch.ts'
import { countWord, priorityWord } from './readoutWords.ts'
import { askListCap } from './queueGrowth.ts'

// The readback side of the main view's dispatch (`dispatch.ts`): a buffer of its ring taken, the
// copy read behind the reads in flight, landed in the chain and adopted when it may be.

/** True when the readback copied last is `next`'s, on the residency and the poses in place. The
 *  cut submitted last is the main view's in the swap (`sameCut`). */
export const readFor = (state: DagRuntimeState, next: SelectionUniforms) =>
  stampMatches(state.readback, next, state)

/** What a main readback was copied from: the cut `serial` under `captured`, and — stamped at its
 *  submit (`readMain`) — the poses and the withdrawals in place
 *  (`DagRuntimeState.withdrawnRevision`); `cut`, the main view's it lands in. */
export type MainCopy = {
  cut: MainCut
  captured: SelectionUniforms
  serial: number
  world: number
  withdrawn: number
}

/** A copy taken: the ring's buffer (`resources.readbacks`) and what it is copied from. */
export type Copy = { buffer: GPUBuffer; tag: MainCopy }

/** A buffer of the ring for the main cut's lists, copied from the cut `serial` under `captured`;
 *  none when the ring has none. */
export function takeCopy(cut: MainCut, captured: SelectionUniforms, serial = -1): Copy | undefined {
  const { resources } = cut,
    tag: MainCopy = { cut, captured, serial, world: 0, withdrawn: 0 }
  const buffer = resources.readbacks.take(tag, resources.readbackBytes)
  return buffer && { buffer, tag }
}

/** The copy into `buffer` under `tag`, its encoder submitted: stamped with the poses and the
 *  withdrawals in place, and mapped behind the reads in flight (`chainMain`). */
export function readMain(cut: MainCut, { buffer, tag }: Copy) {
  tag.world = cut.state.worldRevision
  tag.withdrawn = cut.state.withdrawnRevision
  cut.resources.readbacks.submitted(buffer)
}

/** The main ring's chain (`createReadbackRing`): each read runs behind the reads and growths in
 *  flight (`state.pending`), in the order the copies were submitted. */
export function chainMain(read: () => Promise<void>, { cut: { state } }: MainCopy) {
  void behind(state, () =>
    read().catch((error: unknown) => {
      // A mapping refused — a device lost says so on its own (`device.lost`) — reads nothing:
      // the next dispatch copies the cut again. Any other error is the engine's: it surfaces.
      state.readback = undefined
      unlessRefused(error)
    }),
  )
}

/** A main readback mapped (the ring's `read`): parsed into the arrays of its turn, landed in the
 *  chain, adopted when it may be. */
export function landMain(range: ArrayBuffer, _staging: GPUBuffer, read: MainCopy) {
  const { cut } = read,
    { resources, state, chain, scratch } = cut
  const { outputBytes, readbackBytes: copied, listCap, listFeedback, listCaps } = resources
  const { parsed, demand } = readDagSlot(
    range,
    {
      bytes: copied,
      drawnWordOffset: outputBytes / 4,
      priorityWordOffset: priorityWord(listCap),
      countWordOffset: countWord(listCap),
      scratch: scratch[cut.reads++ % scratch.length],
    },
    { feedback: listFeedback, caps: listCaps },
    // Every copy lands in the chain, adoptable or not: the next is taken against it. A page
    // withdrawn since makes the mask a lie; pages that arrived, or a pose that moved, only make the
    // cut a frame late, as a camera's.
    (words, parsed) =>
      parsed?.drawablePageIds &&
      chain.land(
        new Uint32Array(words, 0, copied >>> 2),
        listCap,
        parsed.requests.pages.length,
        parsed.drawablePageIds.length,
        read.withdrawn === state.withdrawnRevision,
      ),
  )
  // What the cut asked of its lists moves the readout's ranks, made again before the next cut.
  if (!state.disposed) askListCap(resources, state, demand)
  // The rows' queue the cut ranked, while the range is mapped: a cut past a list's cap stamped
  // the rows of what it drew, its image's.
  resources.rowPass?.landed(parsed ? range : undefined, listCap, read.captured.frame ?? -1)
  if (parsed && read.withdrawn === state.withdrawnRevision) {
    state.last = { uniforms: read.captured, result: parsed, worldRevision: read.world }
    if (!parsed.truncated) noteWhole(resources.swap, MAIN_VIEW, read.serial)
  } else if (!parsed) state.readback = undefined
}
