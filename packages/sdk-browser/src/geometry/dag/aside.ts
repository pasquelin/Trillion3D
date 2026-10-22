import type { SelectionSubmission, SelectionUniforms } from '../../gpu/core/selection.ts'
import type { AsideCut } from '../../gpu/core/aside.ts'
import { copySelectionUniforms } from '../../gpu/core/selectionCopy.ts'
import { writeDagUniforms } from './uniforms.ts'
import { encodeDagKernels, encodeDagPost } from './encode.ts'
import { twoPassOf } from './shader/occlusionWgsl.ts'
import type { CutPyramid } from './occlusion.ts'
import { countWord, listWords, priorityWord } from './readoutWords.ts'
import type { DagRuntimeState } from './runtime/runtimeState.ts'
import type { DagResources } from './resources.ts'
import {
  holdSwap,
  inPlace,
  noteCut,
  releaseAsideView,
  restorable,
  sameCut,
  saveRegionFor,
  takeAsideView,
} from './swap/swap.ts'
import { cutTablesAt, tablesHeld } from './queueGrowth.ts'
import { writeViewFilter } from './viewFilterRegion.ts'
import { encodeSwap } from './swap/swapEncode.ts'
import { settleOnce } from './settleOnce.ts'
import { asideCopyBytes, createAsideSlots, type AsideCopy, type AsideSlots } from './asideSlots.ts'

/** What a view aside takes of the main cut: its owed copy (`dispatch.ts`, `copyOwed`), and the
 *  step every cut on the tables takes before it encodes (`runtime/runtime.ts`, `syncTables`). */
type MainShare = {
  copyOwed: (encoder: GPUCommandEncoder) => SelectionSubmission | undefined
  syncTables: () => void
}
/** What a view aside's dispatches share: the tables, the state, its token, its readback slots, and
 *  what it takes of the main cut; the pyramid its next cut's main pass reads (`bindPyramid`), and
 *  the cut whose post pass its image encodes (`encodePost`). */
type Aside = MainShare & {
  resources: DagResources
  state: DagRuntimeState
  view: number
  slots: AsideSlots
  /** Whether it is the primed pyramid's cut: no readback, no streaming fed. */
  primed: boolean
  pyramid?: CutPyramid
  post?: { snap: SelectionUniforms; serial: number; held: HeldCopy }
}
/** The lists' copy a dispatch's settlement reads: made in the dispatch, or in its post pass. */
type HeldCopy = { copied?: ReturnType<typeof copyLists> }

const noop = () => {}

/**
 * A VIEW DRAWN BESIDE THE MAIN ONE — a capture, a persistent view (#1097) — CUT ON THE GPU (#1483).
 * The kernels and their tables are the main cut's: the view's camera is written to the uniforms
 * and the cut runs in the view's command buffer, which draws from the mask it leaves. Its requests
 * with their page counts and priorities and its drawn pages are copied into a readback ring of its
 * own (`asideSlots.ts`) — no difference: the host publishes them by hashed difference
 * (`../cut/adoption/publication.ts`). Its occlusion runs in two passes as the main view's does,
 * against its own last pyramid (`../../frame/render/cutPyramid.ts`): the main pass in the dispatch,
 * the post pass and the lists' copy behind the image's first raster pass (`encodePost`). Its first
 * image, a capture's only one, has no pyramid standing for it: it cuts in one pass.
 * The view has a region of `out` of its own (`swap/swap.ts`), asked of the readout when it is made:
 * the mask comes back from it while the view's last cut stands, read back whole, as the main
 * view's does; a view whose mask is in place runs nothing. The kept snapshot the main cut's
 * differences are taken against is never touched, and the main cut's lists no readback copied yet
 * are copied before the view cuts on `out`.
 *
 * Its first readback copies each list whole; the next ones twice what the cut last asked. One whose
 * cut asked past what it copied is never adopted short: while the cut stands, its lists still in
 * `out`, they are copied again at their size — no cut again.
 *
 * `primed`, the cut is the primed pyramid's (`../../frame/render/primeHiz.ts`): it leaves a mask
 * for one small draw and nothing else — its lists are copied by no readback, so no page is asked
 * and no view adopts it, and the rows its pages use are stamped by no pass.
 */
export function createAsideCut(
  resources: DagResources,
  state: DagRuntimeState,
  main: MainShare,
  primed = false,
): AsideCut {
  const view = takeAsideView(resources.swap)
  const aside: Aside = {
    resources,
    state,
    view,
    slots: createAsideSlots(resources, state, view),
    primed,
    ...main,
  }
  return {
    dispatch: (uniforms, shared) => dispatchAside(aside, uniforms, shared),
    encodePost: (encoder, pyramid) => encodeAsidePost(aside, encoder, pyramid),
    bindPyramid: (pyramid) => void (aside.pyramid = pyramid),
    peek: () => aside.slots.last,
    async flush() {
      // Tables being made again hold every cut on them (`tablesHeld`): the view's first image
      // asks its region so. Its next image cuts only once they are made.
      await state.pending
      await aside.slots.pending
      return aside.slots.last
    },
    dispose() {
      aside.slots.disposed = true
      releaseAsideView(resources.swap, view)
      // The reads queued map nothing; one mapping is cut short, quietly.
      aside.slots.ring.destroy()
    },
  }
}

/** The view's dispatch: nothing when its mask is in place and its lists read, a copy of them when
 *  they are owed one, its mask back from its region when its cut stands, else a cut. */
function dispatchAside(aside: Aside, uniforms: SelectionUniforms, shared: GPUCommandEncoder) {
  const { resources, state, view, slots } = aside,
    { swap } = resources
  // Bound for this dispatch alone, and a post pass for its image alone.
  const pyramid = aside.pyramid
  aside.pyramid = undefined
  aside.post = undefined
  if (slots.disposed) return undefined
  // What moved since the last cut reaches the tables before this view reads them, as before the
  // main view's cut.
  aside.syncTables()
  if (tablesHeld(resources, state)) return undefined
  const same = sameCut(swap, view, uniforms, state)
  // The mask in place is this very cut's: nothing to run — but its lists, neither read whole nor
  // in flight, copied again at their size while they are still in `out`.
  const last = swap.cuts[view - 1]
  if (aside.primed && last && same && inPlace(swap, view)) return noop
  if (last && same && inPlace(swap, view)) {
    if (slots.whole === last.serial || slots.inFlight === last.serial) return noop
    if (swap.outOwner === view) {
      const copied = copyLists(aside, last.uniforms, shared, last.serial)
      return settleAside(aside, { copied }, noop)
    }
  }
  // Its last cut stands and was read back whole: its mask comes back from its region.
  if (same && last?.whole && restorable(swap, view)) return encodeSwap(resources, view, shared)
  return cutAside(aside, uniforms, shared, pyramid)
}

/** Cuts `uniforms` into `shared`, the main cut's lists owed copied first; its lists copied into a
 *  readback when the ring has one — behind its post pass when it runs two (`encodePost`), its main
 *  pass reading `pyramid`. */
function cutAside(
  aside: Aside,
  uniforms: SelectionUniforms,
  shared: GPUCommandEncoder,
  pyramid: CutPyramid | undefined,
) {
  const { resources, state, view } = aside,
    { swap, uniformData, packed, listCap } = resources
  const owed = aside.copyOwed(shared)
  const undo = holdSwap(swap, view)
  const region = saveRegionFor(swap, view)
  writeDagUniforms(uniformData, packed, uniforms, listCap, region, cutTablesAt(resources))
  resources.device.queue.writeBuffer(resources.uniforms, 0, uniformData)
  writeViewFilter(resources, uniforms.filter)
  const post = twoPassOf(uniforms)
  encodeDagKernels(shared, resources, { post, pyramid, stamp: !aside.primed })
  // One copy of the uniforms, kept by the swap and by the readback alike: none is written after.
  const snap = copySelectionUniforms(uniforms)
  const serial = noteCut(swap, view, {
    uniforms: snap,
    residency: state.residencyRevision,
    world: state.worldRevision,
  })
  const held: HeldCopy = {}
  if (post) aside.post = { snap, serial, held }
  else if (!aside.primed) held.copied = copyLists(aside, snap, shared, serial)
  return settleAside(aside, held, () => (owed?.(false), undo(), (aside.post = undefined)), owed)
}

/** `AsideCut.encodePost`: the post pass of the cut the view's last dispatch left open, its finish
 *  and its lists' copy, into `encoder`; false when it left none. */
function encodeAsidePost(
  aside: Aside,
  encoder: GPUCommandEncoder,
  pyramid: CutPyramid | undefined,
) {
  const open = aside.post
  if (!open) return false
  aside.post = undefined
  encodeDagPost(encoder, aside.resources, pyramid, false)
  open.held.copied = copyLists(aside, open.snap, encoder, open.serial)
  return true
}

/** Copies `out`'s lists, the cut `serial` under `snap`, into a readback of `shared`; nothing when
 *  every one is still read: the lists are copied at a later image, while the cut stands. */
function copyLists(
  { resources, state, slots }: Aside,
  snap: SelectionUniforms,
  shared: GPUCommandEncoder,
  serial: number,
) {
  const { output, listCap } = resources,
    ranks = Math.min(slots.copied, listCap),
    bytes = listWords(ranks) * 4
  const captured = { uniforms: snap, worldRevision: state.worldRevision }
  const copy: AsideCopy = { ranks, listCap, captured, serial, withdrawn: -1 }
  const target = slots.ring.take(copy, asideCopyBytes(ranks))
  if (!target) return undefined
  // The requests, then the drawn list right behind them, each its header and `ranks` ranks, then
  // the requests' priorities and their page counts, `ranks` of each.
  shared.copyBufferToBuffer(output, 0, target, 0, bytes)
  shared.copyBufferToBuffer(output, listWords(listCap) * 4, target, bytes, bytes)
  shared.copyBufferToBuffer(output, priorityWord(listCap) * 4, target, 2 * bytes, ranks * 4)
  const counts = 2 * bytes + ranks * 4
  shared.copyBufferToBuffer(output, countWord(listCap) * 4, target, counts, ranks * 4)
  slots.inFlight = serial
  const read = () => {
    copy.withdrawn = state.withdrawnRevision
    slots.ring.submitted(target)
  }
  return { target, copy, read }
}

/** The submission of a view's dispatch: its copy — `held`, made by the dispatch or its post pass —
 *  read once the buffer ran, its readback and `undo` given back when it is dropped; `owed`, the
 *  main cut's copy in the same buffer, settled with it. */
function settleAside(
  { slots }: Aside,
  held: HeldCopy,
  undo: () => void,
  owed?: SelectionSubmission,
): SelectionSubmission {
  return settleOnce(
    () => {
      const { copied } = held
      if (copied) {
        slots.ring.dropped(copied.target)
        slots.settled(copied.copy)
      }
      undo()
    },
    () => {
      owed?.(true)
      held.copied?.read()
    },
  )
}
