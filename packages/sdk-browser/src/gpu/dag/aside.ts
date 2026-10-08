import type { SelectionSubmission, SelectionUniforms, TableSync } from '../core/selection.ts'
import type { AsideCut } from '../core/aside.ts'
import { copySelectionUniforms } from '../core/selectionCopy.ts'
import { writeDagUniforms } from './uniforms.ts'
import { encodeDagKernels } from './encode.ts'
import { SELECTION_HEADER_WORDS, levelCountsWord } from './layout.ts'
import { ADMISSION_BUCKETS } from './request.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { createDagResources } from './resources.ts'
import {
  holdSwap,
  inPlace,
  noteCut,
  releaseAsideView,
  restorable,
  sameCut,
  saveRegionFor,
  takeAsideView,
} from './swap.ts'
import { tablesHeld } from './listCap.ts'
import { pickSlot } from './readbackSlot.ts'
import { encodeSwap } from './swapEncode.ts'
import { createAsideSlots, type AsideSlots } from './asideSlots.ts'

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>
/** What a view aside takes of the main cut: its owed copy (`dispatch.ts`, `copyOwed`), and the
 *  step every cut on the tables takes before it encodes (`runtime.ts`, `syncTables`). */
type MainShare = {
  copyOwed: (encoder: GPUCommandEncoder) => SelectionSubmission | undefined
  syncTables: TableSync
}
/** What a view aside's dispatches share: the tables, the state, its token, its readback slots, and
 *  what it takes of the main cut. */
type Aside = MainShare & {
  resources: DagResources
  state: DagRuntimeState
  view: number
  slots: AsideSlots
}

const noop = () => {}

/**
 * A VIEW DRAWN BESIDE THE MAIN ONE — a capture, a persistent view (#1097) — CUT ON THE GPU (#1483).
 * The kernels and their tables are the main cut's: the view's camera is written to the uniforms
 * and the cut runs in the view's command buffer, which draws from the mask it leaves. Its requests
 * and drawn pages are copied into slots of its own (`asideSlots.ts`) — no eviction queue, no
 * difference: the host publishes them by hashed difference (`../../webgpu/cut/publication.ts`).
 * The view has a region of `out` of its own (`swap.ts`), asked of the list growth when it is made:
 * the mask comes back from it while the view's last cut stands, read back whole, as the main
 * view's does; a view whose mask is in place runs nothing. The kept snapshot the main cut's
 * differences are taken against is never touched, and the main cut's lists no slot copied yet are
 * copied before the view cuts on `out`.
 *
 * Its first readback copies each list whole; the next ones twice what the cut last asked. One whose
 * cut asked past what it copied is never adopted short: while the cut stands, its lists still in
 * `out`, they are copied again at their size — no cut again.
 */
export function createAsideCut(
  resources: DagResources,
  state: DagRuntimeState,
  main: MainShare,
): AsideCut {
  const view = takeAsideView(resources.swap)
  const aside: Aside = {
    resources,
    state,
    view,
    slots: createAsideSlots(resources, state, view),
    ...main,
  }
  return {
    dispatch: (uniforms, shared) => dispatchAside(aside, uniforms, shared),
    peek: () => aside.slots.last,
    async flush() {
      // A list or regions being grown hold every cut on the tables (`tablesHeld`): the view's
      // first image asks its region so. Its next image cuts only once they are made.
      await state.pending
      await aside.slots.pending
      return aside.slots.last
    },
    dispose() {
      aside.slots.disposed = true
      releaseAsideView(resources.swap, view)
      aside.slots.release()
    },
  }
}

/** The view's dispatch: nothing when its mask is in place and its lists read, a copy of them when
 *  they are owed one, its mask back from its region when its cut stands, else a cut. */
function dispatchAside(aside: Aside, uniforms: SelectionUniforms, shared: GPUCommandEncoder) {
  const { resources, state, view, slots } = aside,
    { swap } = resources
  if (slots.disposed) return undefined
  // What moved since the last cut reaches the tables before this view reads them, as before the
  // main view's cut.
  aside.syncTables(uniforms, aside)
  if (tablesHeld(resources, state)) return undefined
  const same = sameCut(swap, view, uniforms, state)
  // The mask in place is this very cut's: nothing to run — but its lists, neither read whole nor
  // in flight, copied again at their size while they are still in `out`.
  const last = swap.cuts[view - 1]
  if (last && same && inPlace(swap, view)) {
    if (slots.whole === last.serial || slots.inFlight === last.serial) return noop
    if (swap.outOwner === view)
      return settleAside(aside, copyLists(aside, last.uniforms, shared, last.serial), noop)
  }
  // Its last cut stands and was read back whole: its mask comes back from its region.
  if (same && last?.whole && restorable(swap, view)) return encodeSwap(resources, view, shared)
  return cutAside(aside, uniforms, shared)
}

/** Cuts `uniforms` into `shared`, the main cut's lists owed copied first; its lists copied into a
 *  slot when one is free. */
function cutAside(aside: Aside, uniforms: SelectionUniforms, shared: GPUCommandEncoder) {
  const { resources, state, view } = aside,
    { swap, uniformData, packed, listCap } = resources
  const owed = aside.copyOwed(shared)
  const undo = holdSwap(swap, view)
  const { coarsen } = aside.slots
  writeDagUniforms(uniformData, packed, uniforms, listCap, saveRegionFor(swap, view), coarsen)
  resources.device.queue.writeBuffer(resources.uniforms, 0, uniformData)
  encodeDagKernels(shared, resources, false)
  // One copy of the uniforms, kept by the swap and by the readback alike: none is written after.
  const snap = copySelectionUniforms(uniforms)
  const serial = noteCut(swap, view, {
    uniforms: snap,
    residency: state.residencyRevision,
    world: state.worldRevision,
  })
  const copied = copyLists(aside, snap, shared, serial)
  return settleAside(aside, copied, () => (owed?.(false), undo()), owed)
}

/** Copies `out`'s lists, the cut `serial` under `snap`, into a free slot of `shared`; nothing when
 *  both slots are still read: the lists are copied at a later image, while the cut stands. */
function copyLists(
  { resources, state, slots }: Aside,
  snap: SelectionUniforms,
  shared: GPUCommandEncoder,
  serial: number,
) {
  const i = pickSlot(slots.mapped, slots.next)
  if (i < 0) return undefined
  const { output, listCap } = resources,
    ranks = Math.min(slots.copied, listCap),
    bytes = (SELECTION_HEADER_WORDS + ranks) * 4,
    target = slots.slotOf(i, 2 * bytes + ADMISSION_BUCKETS * 4)
  // The requests, then the drawn list right behind them, each its header and `ranks` ranks, then
  // the requests' admission counts.
  shared.copyBufferToBuffer(output, 0, target, 0, bytes)
  shared.copyBufferToBuffer(output, (SELECTION_HEADER_WORDS + listCap) * 4, target, bytes, bytes)
  const counts = levelCountsWord(listCap) * 4
  shared.copyBufferToBuffer(output, counts, target, 2 * bytes, ADMISSION_BUCKETS * 4)
  slots.mapped[i] = true
  slots.next = 1 - i
  slots.inFlight = slots.copiedSerial[i] = serial
  const captured = { uniforms: snap, worldRevision: state.worldRevision, coarsen: slots.coarsen }
  return { i, read: () => slots.read(i, ranks, listCap, captured, serial) }
}

/** The submission of a view's dispatch: its copy read once the buffer ran, its slot and `undo`
 *  given back when it is dropped; `owed`, the main cut's copy in the same buffer, settled with it. */
function settleAside(
  { slots }: Aside,
  copied: ReturnType<typeof copyLists>,
  undo: () => void,
  owed?: SelectionSubmission,
): SelectionSubmission {
  let settled = false
  return (submitted: boolean) => {
    if (settled) return
    settled = true
    if (submitted) return void (owed?.(true), copied?.read())
    if (copied) slots.dropped(copied.i)
    undo()
  }
}
