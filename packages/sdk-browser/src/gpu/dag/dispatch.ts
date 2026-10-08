import type { GpuSelection, SelectionSubmission, SelectionUniforms } from '../core/selection.ts'
import { copySelectionUniforms } from '../core/selectionCopy.ts'
import { createDagOutputScratch, writeDagUniforms, type DagOutputScratch } from './uniforms.ts'
import type { createDagResources } from './resources.ts'
import { encodeDagKernels } from './encode.ts'
import { encodeDagDifference } from './encodeDifference.ts'
import { DAG_READBACK_SLOTS as SLOTS } from './layout.ts'
import { tablesHeld } from './listCap.ts'
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
import { pickSlot } from './readbackSlot.ts'
import { readFor, readMain } from './dispatchRead.ts'
import { encodeSwap } from './swapEncode.ts'

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>
type Chain = ReturnType<typeof createDifferenceChain>
/** What the main view's dispatches share: the tables, the state, the chain the readbacks land in,
 *  and one set of arrays per readback slot. */
export type MainCut = {
  resources: DagResources
  state: DagRuntimeState
  chain: Chain
  scratch: DagOutputScratch[]
}

/**
 * The main view's cut and the copy of its readback (`GpuSelection['dispatch']`), and `copyOwed`:
 * a view aside about to cut on `out` first copies the main cut's lists no slot took yet. One set of
 * arrays per slot: the snapshot rewrites them instead of reallocating; the pair handed to the
 * caller stays new on every readback, so it always tells two snapshots apart by identity — what
 * adoption compares to know if the cut moved.
 */
export function createDagDispatch(resources: DagResources, state: DagRuntimeState, chain: Chain) {
  const cut: MainCut = {
    resources,
    state,
    chain,
    scratch: Array.from({ length: SLOTS }, createDagOutputScratch),
  }
  const dispatch: GpuSelection['dispatch'] = (next, shared) => dispatchMain(cut, next, shared)
  return { dispatch, copyOwed: (encoder: GPUCommandEncoder) => copyOwed(cut, encoder) }
}

/** The main view's dispatch: it cuts when its inputs moved, brings its mask back from its region
 *  when its cut stands, and copies the readback the host has not had yet when a slot is free. */
function dispatchMain(cut: MainCut, next: SelectionUniforms, shared?: GPUCommandEncoder) {
  const { resources, state } = cut
  if (tablesHeld(resources, state)) return undefined
  const { swap } = resources
  let compute = !sameCut(swap, MAIN_VIEW, next, state)
  const needsReadback = !readFor(state, next),
    i = needsReadback ? pickSlot(state.mapped, state.slot) : -1
  // The mask, or the lists a copy reads, are a view's drawn aside (`swap.ts`): the main view's
  // mask comes back from its journal when its cut stands, or it cuts again.
  if (swap.owner !== MAIN_VIEW || (needsReadback && swap.outOwner !== MAIN_VIEW)) {
    // Not computing, the cut in hand is `next`'s (`sameCut`): read back whole, its mask comes back.
    const back = !compute && !needsReadback && restorable(swap, MAIN_VIEW)
    if (back && swap.cuts[MAIN_VIEW - 1]?.whole) return encodeSwap(resources, MAIN_VIEW, shared)
    // The mask in place is this very cut's, its lists another view's: they come back by a cut,
    // once a slot can take their copy — not image after image before.
    if (!compute && i < 0 && inPlace(swap, MAIN_VIEW)) return undefined
    compute = true
  }
  if (!compute && i < 0) return undefined
  const encoder = shared ?? resources.device.createCommandEncoder()
  const undo = holdDispatch(swap, state)
  // One copy of the uniforms a dispatch, shared by all that keeps them: none is written after.
  const snap = copySelectionUniforms(next)
  if (compute) cutMain(cut, encoder, snap, i >= 0)
  else encodeDagDifference(encoder, resources)
  if (i >= 0) claimCopy(cut, encoder, i, snap)
  const settled = { encoder, shared, i, captured: snap, serial: swap.cut, undo }
  return settleMain(cut, { ...settled, coarsen: state.coarsen })
}

/** The main cut's lists, still in `out` and copied by no slot, copied into `encoder` before a view
 *  aside cuts on `out` (`aside.ts`): its readback then needs no cut again. None owed, the residency
 *  or the poses moved since, or no slot free: nothing. */
function copyOwed(cut: MainCut, encoder: GPUCommandEncoder): SelectionSubmission | undefined {
  const { resources, state } = cut,
    { swap } = resources,
    main = swap.cuts[MAIN_VIEW - 1]
  if (!main || state.owed < 0 || state.owed !== main.serial) return undefined
  if (swap.outOwner !== MAIN_VIEW || main.residency !== state.residencyRevision) return undefined
  if (main.world !== state.worldRevision) return undefined
  const captured = main.uniforms,
    i = pickSlot(state.mapped, state.slot)
  if (i < 0) return undefined
  const undo = holdClaims(state),
    serial = state.owed
  encodeDagDifference(encoder, resources)
  claimCopy(cut, encoder, i, captured)
  const coarsen = state.coarsen
  return settleMain(cut, { encoder, shared: encoder, i, captured, serial, coarsen, undo })
}

/** The main view cuts under `snap` into `encoder`, its difference in the cut's last pass when a
 *  copy follows; a cut no slot copies is owed (`copyOwed`). */
function cutMain(cut: MainCut, encoder: GPUCommandEncoder, snap: SelectionUniforms, copy: boolean) {
  const { resources, state } = cut,
    { swap, uniformData, packed, listCap } = resources
  writeDagUniforms(
    uniformData,
    packed,
    snap,
    listCap,
    saveRegionFor(swap, MAIN_VIEW),
    state.coarsen,
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

/** Slot `i` takes `out`'s lists, under `captured`, into `encoder`. */
function claimCopy(
  { resources, state }: MainCut,
  encoder: GPUCommandEncoder,
  i: number,
  captured: SelectionUniforms,
) {
  encoder.copyBufferToBuffer(resources.output, 0, resources.readback[i], 0, resources.readbackBytes)
  state.readback = {
    uniforms: captured,
    residency: state.residencyRevision,
    world: state.worldRevision,
  }
  state.mapped[i] = true
  state.slot = (i + 1) % SLOTS
  state.owed = -1
}

/** The submission of a dispatch: slot `i` (-1 none), copied from the main cut `serial` under
 *  `captured` and the factor `coarsen` (`listCap.ts`), read once the buffer ran; everything
 *  claimed given back (`undo`) when it is dropped. Without `shared`, submitted here. */
function settleMain(
  cut: MainCut,
  done: {
    encoder: GPUCommandEncoder
    shared: GPUCommandEncoder | undefined
    i: number
    captured: SelectionUniforms
    serial: number
    coarsen: number
    undo: () => void
  },
): SelectionSubmission | undefined {
  const { encoder, shared, i, undo } = done
  const read = { captured: done.captured, serial: done.serial, coarsen: done.coarsen }
  if (!shared) {
    cut.resources.device.queue.submit([encoder.finish()])
    if (i >= 0) readMain(cut, i, read)
    return undefined
  }
  let settled = false
  return (submitted: boolean) => {
    if (settled) return
    settled = true
    if (submitted) return void (i >= 0 && readMain(cut, i, read))
    undo()
    if (i >= 0) cut.state.mapped[i] = false
  }
}

/** What a dispatch claims of the state — the readback stamp by its pointer, the slot, the owed
 *  cut — given back by the returned function when its command buffer is dropped: a copy that never
 *  runs would leave its slot mapped for ever, and must not be remembered as read. The cut submitted
 *  is the swap's, held by `holdSwap`. */
function holdClaims(state: DagRuntimeState) {
  const { readback, slot, owed } = state
  return () => {
    state.readback = readback
    state.slot = slot
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
