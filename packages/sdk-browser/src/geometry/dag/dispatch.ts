import type {
  GpuSelection,
  SelectionSubmission,
  SelectionUniforms,
} from '../../gpu/core/selection.ts'
import { copySelectionUniforms } from '../../gpu/core/selectionCopy.ts'
import { createDagOutputScratch, writeDagUniforms, type DagOutputScratch } from './uniforms.ts'
import type { DagResources } from './resources.ts'
import { encodeDagKernels, encodeDagPost } from './encode.ts'
import { twoPassOf } from './shader/occlusionWgsl.ts'
import type { CutPyramid } from './occlusion.ts'
import { encodeDagDifference } from './encodeDifference.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { cutTablesAt, tablesHeld } from './queueGrowth.ts'
import { writeViewFilter } from './viewFilterRegion.ts'
import type { createDifferenceChain } from './differenceChain.ts'
import {
  MAIN_VIEW,
  holdSwap,
  inPlace,
  noteCut,
  restorable,
  sameCut,
  saveRegionFor,
} from './swap/swap.ts'
import type { DagRuntimeState } from './runtime/runtimeState.ts'
import { readFor, readMain, takeCopy, type Copy } from './dispatchRead.ts'
import { encodeSwap } from './swap/swapEncode.ts'
import { settleOnce } from './settleOnce.ts'

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
  /** The pyramid the next cut's main pass reads, the previous image's (`GpuSelection.bindPyramid`):
   *  none, a blank one, which hides nothing. */
  pyramid?: CutPyramid
  /** The cut whose post pass the image encodes (`encodeMainPost`), and the copy its readback
   *  takes once it is finished. */
  post?: { copy: Copy | undefined }
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
    scratch: Array.from({ length: DAG_READBACK_SLOTS }, createDagOutputScratch),
    reads: 0,
  }
  const dispatch: GpuSelection['dispatch'] = (next, shared) => dispatchMain(cut, next, shared)
  return {
    dispatch,
    copyOwed: (encoder: GPUCommandEncoder) => copyOwed(cut, encoder),
    encodePost: (encoder: GPUCommandEncoder, pyramid: CutPyramid | undefined) =>
      encodeMainPost(cut, encoder, pyramid),
    bindPyramid: (pyramid: CutPyramid | undefined) => void (cut.pyramid = pyramid),
  }
}

/** The main view's dispatch: it cuts when its inputs moved, brings its mask back from its region
 *  when its cut stands, and copies the readback the host has not had yet when the ring has room. */
function dispatchMain(cut: MainCut, next: SelectionUniforms, shared?: GPUCommandEncoder) {
  const { resources, state } = cut
  // Bound for this dispatch alone: an image whose target was made again binds the new one.
  const pyramid = cut.pyramid
  cut.pyramid = undefined
  if (tablesHeld(resources, state)) return undefined
  const { swap } = resources
  let compute = !sameCut(swap, MAIN_VIEW, next, state)
  const needsReadback = !readFor(state, next),
    room = needsReadback && resources.readbacks.available()
  // The mask, or the lists a copy reads, are a view's drawn aside (`swap/swap.ts`): the main view's
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
  const undo = holdDispatch(cut)
  // A cut in two passes leaves its post pass, its finish and its copy to the image, behind its
  // first raster pass (`encodePost`): one submitting a command buffer of its own has no raster to
  // wait for, and cuts in one pass.
  if (!shared) snap.occlusion = 0
  const post = compute && twoPassOf(snap)
  if (compute) cutMain(cut, encoder, { snap, copy: !!copy, post, pyramid })
  else encodeDagDifference(encoder, resources)
  if (copy) copy.tag.serial = swap.cut
  if (post) cut.post = { copy }
  else if (copy) claimCopy(cut, encoder, copy)
  return settleMain(cut, { encoder, shared, copy, undo })
}

/** `GpuSelection.encodePost`: the post pass of the cut the last dispatch left open, its finish and
 *  its readback's copy, into `encoder`; false when it left none. */
function encodeMainPost(cut: MainCut, encoder: GPUCommandEncoder, pyramid: CutPyramid | undefined) {
  const open = cut.post
  if (!open) return false
  cut.post = undefined
  encodeDagPost(encoder, cut.resources, pyramid, !!open.copy)
  if (open.copy) claimCopy(cut, encoder, open.copy)
  return true
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

/** The main view cuts under `snap` into `encoder` — its main pass alone when `post`, on `pyramid`
 *  (`MainCut.pyramid`) —, its difference in the cut's last pass when a copy follows; a cut no
 *  readback copies is owed (`copyOwed`). */
function cutMain(
  cut: MainCut,
  encoder: GPUCommandEncoder,
  {
    snap,
    copy,
    post,
    pyramid,
  }: { snap: SelectionUniforms; copy: boolean; post: boolean; pyramid?: CutPyramid },
) {
  const { resources, state } = cut,
    { swap, uniformData, packed, listCap } = resources
  writeDagUniforms(
    uniformData,
    packed,
    snap,
    listCap,
    saveRegionFor(swap, MAIN_VIEW),
    cutTablesAt(resources),
  )
  resources.device.queue.writeBuffer(resources.uniforms, 0, uniformData)
  writeViewFilter(resources, snap.filter)
  encodeDagKernels(encoder, resources, { differ: copy, post, pyramid })
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
  return settleOnce(
    () => {
      undo()
      if (copy) cut.resources.readbacks.dropped(copy.buffer)
    },
    () => copy && readMain(cut, copy),
  )
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

/** The swap's and the state's claims held together (`holdSwap`, `holdClaims`), and the post pass
 *  the dispatch leaves open: a dropped image encodes none. */
function holdDispatch(cut: MainCut) {
  const swapBack = holdSwap(cut.resources.swap, MAIN_VIEW),
    claimsBack = holdClaims(cut.state)
  return () => {
    claimsBack()
    swapBack()
    cut.post = undefined
  }
}
