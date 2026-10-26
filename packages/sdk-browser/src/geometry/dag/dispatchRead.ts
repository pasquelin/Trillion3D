import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import { stampMatches } from './owner/cutOwner.ts'
import type { DagRuntimeState } from './runtime/runtimeState.ts'
import { readDagSlot } from './readbackSlot.ts'
import { unlessRefused } from '../../gpu/core/readbackRing.ts'
import { behind } from '../../gpu/core/behind.ts'
import type { MainCut } from './dispatch.ts'
import { countWord, priorityWord } from './readoutWords.ts'
import { askListCap } from './queueGrowth.ts'

// The readback side of the main view's dispatch (`dispatch.ts`): a buffer of its ring taken, the
// copy read behind the reads in flight, parsed and adopted when it may be.

/** True when the readback copied last is `next`'s, on the residency and the poses in place. */
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

/** A main readback mapped (the ring's `read`): parsed into the arrays of its turn and adopted when
 *  it may be. */
export function landMain(range: ArrayBuffer, _staging: GPUBuffer, read: MainCopy) {
  const { cut } = read,
    { resources, state, scratch } = cut
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
  )
  // What the cut asked of its lists moves the readout's ranks and the visible list's room, made
  // again before the next cut.
  if (!state.disposed) askListCap(resources, state, demand, parsed?.peaks)
  // A page withdrawn since makes the readback a lie; pages that arrived, or a pose that moved,
  // only make the cut a frame late, as a camera's.
  if (parsed && read.withdrawn === state.withdrawnRevision) {
    state.last = { uniforms: read.captured, result: parsed, worldRevision: read.world }
  } else if (!parsed) state.readback = undefined
}
