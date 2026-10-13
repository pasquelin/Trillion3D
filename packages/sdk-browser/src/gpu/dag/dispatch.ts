import type { GpuSelection, SelectionSubmission, SelectionUniforms } from '../core/selection.ts'
import { copySelectionUniforms } from '../core/selectionCopy.ts'
import { createDagOutputScratch, writeDagUniforms, type DagOutputScratch } from './uniforms.ts'
import type { DagResources } from './resources.ts'
import { encodeDagKernels } from './encode.ts'
import { encodeDagDifference } from './encodeDifference.ts'
import { DAG_READBACK_SLOTS as SLOTS } from './layout.ts'
import { cutTablesAt, tablesHeld } from './queueGrowth.ts'
import type { createDifferenceChain } from './differenceChain.ts'
import {
  MAIN_VIEW,
  holdSwap,
  inPlace,
  noteCut,
  restorable,
  sameCut,
  saveRegionFor,
} from './swap.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import { readFor, readMain, takeCopy, type Copy } from './dispatchRead.ts'
import { encodeSwap } from './swapEncode.ts'

type Chain = ReturnType<typeof createDifferenceChain>
/** What the main view's dispatches share: the tables, the state, the chain the readbacks land in,
 *  one set of arrays per readback in flight, and the readbacks read so far — whose arrays the next
 *  one takes, in turn. */
export type MainCut = {
  resources: DagResources
  state: DagRuntimeState
  chain: Chain
  scratch: DagOutputScratch[]
  reads: number
}

/**
 * The main view's cut and the copy of its readback (`GpuSelection['dispatch']`), and `copyOwed`:
 * a view aside about to cut on `out` first copies the main cut's lists no readback took yet. One
 * set of arrays per readback in flight: the snapshot rewrites them instead of reallocating; the
 * pair handed to the caller stays new on every readback, so it always tells two snapshots apart by
 * identity — what adoption compares to know if the cut moved.
 */
export function createDagDispatch(resources: DagResources, state: DagRuntimeState, chain: Chain) {
  const cut: MainCut = {
    resources,
    state,
    chain,
    scratch: Array.from({ length: SLOTS }, createDagOutputScratch),
    reads: 0,
  }
  const dispatch: GpuSelection['dispatch'] = (next, shared) => dispatchMain(cut, next, shared)
  return { dispatch, copyOwed: (encoder: GPUCommandEncoder) => copyOwed(cut, encoder) }
}

/** The main view's dispatch: it cuts when its inputs moved, brings its mask back from its region
 *  when its cut stands, and copies the readback the host has not had yet when the ring has room. */
function dispatchMain(cut: MainCut, next: SelectionUniforms, shared?: GPUCommandEncoder) {
  const { resources, state } = cut
  if (tablesHeld(resources, state)) return undefined
  const { swap } = resources
  let compute = !sameCut(swap, MAIN_VIEW, next, state)
  const needsReadback = !readFor(state, next),
    room = needsReadback && resources.readbacks.available()
  // The mask, or the lists a copy reads, are a view's drawn aside (`swap.ts`): the main view's
  // mask comes back from its journal when its cut stands, or it cuts again.
  if (swap.owner !== MAIN_VIEW || (needsReadback && swap.outOwner !== MAIN_VIEW)) {
    // Not computing, the cut in hand is `next`'s (`sameCut`): read back whole, its mask comes back.
    const back = !compute && !needsReadback && restorable(swap, MAIN_VIEW)
    if (back && swap.cuts[MAIN_VIEW - 1]?.whole) return encodeSwap(resources, MAIN_VIEW, shared)
    // The mask in place is this very cut's, its lists another view's: they come back by a cut,
    // once the ring can take their copy — not image after image before.
    if (!compute && !room && inPlace(swap, MAIN_VIEW)) return undefined
    compute = true
  }
  if (!compute && !room) return undefined
  // One copy of the uniforms a dispatch, shared by all that keeps them: none is written after.
  const snap = copySelectionUniforms(next)
  // Taken before the cut is encoded: its difference rides in the cut's last pass only when a copy
  // follows. A buffer the device refuses leaves the cut owed.
  const copy = room ? takeCopy(cut, snap) : undefined
  if (!compute && !copy) return undefined
  const encoder = shared ?? resources.device.createCommandEncoder()
  const undo = holdDispatch(swap, state)
  if (compute) cutMain(cut, encoder, snap, !!copy)
  else encodeDagDifference(encoder, resources)
  if (copy) {
    copy.tag.serial = swap.cut
    claimCopy(cut, encoder, copy)
  }
  return settleMain(cut, { encoder, shared, copy, undo })
}

/** The main cut's lists, still in `out` and copied by no readback, copied into `encoder` before a
 *  view aside cuts on `out` (`aside.ts`): its readback then needs no cut again. None owed, the
 *  residency or the poses moved since, or no buffer free: nothing. */
function copyOwed(cut: MainCut, encoder: GPUCommandEncoder): SelectionSubmission | undefined {
  const { resources, state } = cut,
    { swap } = resources,
    main = swap.cuts[MAIN_VIEW - 1]
  if (!main || state.owed < 0 || state.owed !== main.serial) return undefined
  if (swap.outOwner !== MAIN_VIEW || main.residency !== state.residencyRevision) return undefined
  if (main.world !== state.worldRevision) return undefined
  const copy = takeCopy(cut, main.uniforms, state.owed)
  if (!copy) return undefined
  const undo = holdClaims(state)
  encodeDagDifference(encoder, resources)
  claimCopy(cut, encoder, copy)
  return settleMain(cut, { encoder, shared: encoder, copy, undo })
}

/** The main view cuts under `snap` into `encoder`, its difference in the cut's last pass when a
 *  copy follows; a cut no readback copies is owed (`copyOwed`). */
function cutMain(cut: MainCut, encoder: GPUCommandEncoder, snap: SelectionUniforms, copy: boolean) {
  const { resources, state } = cut,
    { swap, uniformData, packed, listCap } = resources
  writeDagUniforms(
    uniformData,
    packed,
    snap,
    listCap,
    saveRegionFor(swap, MAIN_VIEW),
    state.coarse.factor,
    cutTablesAt(resources),
  )
  resources.device.queue.writeBuffer(resources.uniforms, 0, uniformData)
  encodeDagKernels(encoder, resources, copy)
  state.factorMoved = false
  noteCut(swap, MAIN_VIEW, {
    uniforms: snap,
    residency: state.residencyRevision,
    world: state.worldRevision,
  })
  state.owed = copy ? -1 : swap.cut
}

/** `copy` takes `out`'s lists into `encoder`. */
function claimCopy({ resources, state }: MainCut, encoder: GPUCommandEncoder, copy: Copy) {
  encoder.copyBufferToBuffer(resources.output, 0, copy.buffer, 0, resources.readbackBytes)
  state.readback = {
    uniforms: copy.tag.captured,
    residency: state.residencyRevision,
    world: state.worldRevision,
  }
  state.owed = -1
}

/** The submission of a dispatch: its `copy` (none without) read once the buffer ran; everything
 *  claimed given back (`undo`), and the copy's buffer to the ring, when it is dropped. Without
 *  `shared`, submitted here. */
function settleMain(
  cut: MainCut,
  done: {
    encoder: GPUCommandEncoder
    shared: GPUCommandEncoder | undefined
    copy: Copy | undefined
    undo: () => void
  },
): SelectionSubmission | undefined {
  const { encoder, shared, copy, undo } = done
  if (!shared) {
    cut.resources.device.queue.submit([encoder.finish()])
    if (copy) readMain(cut, copy)
    return undefined
  }
  let settled = false
  return (submitted: boolean) => {
    if (settled) return
    settled = true
    if (submitted) return void (copy && readMain(cut, copy))
    undo()
    if (copy) cut.resources.readbacks.dropped(copy.buffer)
  }
}

/** What a dispatch claims of the state — the readback stamp by its pointer, the owed cut — given
 *  back by the returned function when its command buffer is dropped: a copy that never runs must
 *  not be remembered as read. The cut submitted is the swap's, held by `holdSwap`. */
function holdClaims(state: DagRuntimeState) {
  const { readback, owed } = state
  return () => {
    state.readback = readback
    state.owed = owed
  }
}

/** The swap's and the state's claims held together (`holdSwap`, `holdClaims`). */
function holdDispatch(swap: DagResources['swap'], state: DagRuntimeState) {
  const swapBack = holdSwap(swap, MAIN_VIEW),
    claimsBack = holdClaims(state)
  return () => {
    claimsBack()
    swapBack()
  }
}
