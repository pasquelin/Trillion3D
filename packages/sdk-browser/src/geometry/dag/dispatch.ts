import type {
  GpuSelection,
  SelectionSubmission,
  SelectionUniforms,
} from '../../gpu/core/selection.ts'
import { copySelectionUniforms } from '../../gpu/core/selectionCopy.ts'
import { createDagOutputScratch, type DagOutputScratch } from './uniforms.ts'
import type { DagResources } from './resources.ts'
import { encodeDagKernels, encodeDagPost } from './encode.ts'
import { twoPassOf } from './shader/occlusionWgsl.ts'
import type { CutPyramid } from './occlusion.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { tablesHeld } from './queueGrowth.ts'
import { writeCutView } from './viewFilterRegion.ts'
import { MAIN_VIEW, holdOwner, noteCut } from './owner/cutOwner.ts'
import type { DagRuntimeState } from './runtime/runtimeState.ts'
import { readFor, readMain, takeCopy, type Copy } from './dispatchRead.ts'
import { settleOnce } from './settleOnce.ts'

/** What the main view's dispatches share: the tables, the state, one set of arrays per readback in
 *  flight, and the readbacks read so far — whose arrays the next one takes, in turn. */
export type MainCut = {
  resources: DagResources
  state: DagRuntimeState
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
export function createDagDispatch(resources: DagResources, state: DagRuntimeState) {
  const cut: MainCut = {
    resources,
    state,
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

/** The main view's dispatch: it cuts, and copies the readback the host has not had yet when the
 *  ring has room. A cut stands for its own image alone: the visible clusters it leaves are the
 *  ones its raster draws. */
function dispatchMain(cut: MainCut, next: SelectionUniforms, shared?: GPUCommandEncoder) {
  const { resources, state } = cut
  // Bound for this dispatch alone: an image whose target was made again binds the new one.
  const pyramid = cut.pyramid
  cut.pyramid = undefined
  if (tablesHeld(resources, state)) return undefined
  const needsReadback = !readFor(state, next),
    room = needsReadback && resources.readbacks.available()
  // One copy of the uniforms a dispatch, shared by all that keeps them: none is written after.
  const snap = copySelectionUniforms(next)
  // Taken before the cut is encoded. A buffer the device refuses leaves the cut owed.
  const copy = room ? takeCopy(cut, snap) : undefined
  const encoder = shared ?? resources.device.createCommandEncoder()
  const undo = holdDispatch(cut)
  // A cut in two passes leaves its post pass, its finish and its copy to the image, behind its
  // first raster pass (`encodePost`): one submitting a command buffer of its own has no raster to
  // wait for, and cuts in one pass.
  if (!shared) snap.occlusion = 0
  const post = twoPassOf(snap)
  cutMain(cut, encoder, { snap, copy: !!copy, post, pyramid })
  if (copy) copy.tag.serial = resources.owner.serial
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
  encodeDagPost(encoder, cut.resources, pyramid)
  if (open.copy) claimCopy(cut, encoder, open.copy)
  return true
}

/** The main cut's lists, still in `out` and copied by no readback, copied into `encoder` before a
 *  view aside cuts on `out` (`aside.ts`): its readback then needs no cut again. None owed, the
 *  residency or the poses moved since, or no buffer free: nothing. */
function copyOwed(cut: MainCut, encoder: GPUCommandEncoder): SelectionSubmission | undefined {
  const { resources, state } = cut,
    { owner } = resources,
    main = owner.cuts[MAIN_VIEW - 1]
  if (!main || state.owed < 0 || state.owed !== main.serial) return undefined
  if (owner.outOwner !== MAIN_VIEW || main.residency !== state.residencyRevision) return undefined
  if (main.world !== state.worldRevision) return undefined
  const copy = takeCopy(cut, main.uniforms, state.owed)
  if (!copy) return undefined
  const undo = holdClaims(state)
  claimCopy(cut, encoder, copy)
  return settleMain(cut, { encoder, shared: encoder, copy, undo })
}

/** The main view cuts under `snap` into `encoder` — its main pass alone when `post`, on `pyramid`
 *  (`MainCut.pyramid`) —; a cut no readback copies is owed (`copyOwed`). */
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
    { owner } = resources
  writeCutView(resources, snap)
  encodeDagKernels(encoder, resources, { post, pyramid })
  noteCut(owner, MAIN_VIEW, {
    uniforms: snap,
    residency: state.residencyRevision,
    world: state.worldRevision,
  })
  state.owed = copy ? -1 : owner.serial
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
 *  not be remembered as read. The cut submitted is the owner's, held by `holdOwner`. */
function holdClaims(state: DagRuntimeState) {
  const { readback, owed } = state
  return () => {
    state.readback = readback
    state.owed = owed
  }
}

/** The owner's and the state's claims held together (`holdOwner`, `holdClaims`), and the post pass
 *  the dispatch leaves open: a dropped image encodes none. */
function holdDispatch(cut: MainCut) {
  const ownerBack = holdOwner(cut.resources.owner, MAIN_VIEW),
    claimsBack = holdClaims(cut.state)
  return () => {
    claimsBack()
    ownerBack()
    cut.post = undefined
  }
}
