import type { GpuCut, SelectionUniforms } from '../../gpu/core/selection.ts'
import { createDagOutputScratch, type DagOutputScratch } from './uniforms.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { listWords } from './readoutWords.ts'
import type { DagRuntimeState } from './runtime/runtimeState.ts'
import type { DagResources } from './resources.ts'
import { noteWhole } from './swap/swap.ts'
import { readDagSlot } from './readbackSlot.ts'
import { createReadbackRing, unlessRefused } from '../../gpu/core/readbackRing.ts'
import { behind } from '../../gpu/core/behind.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** What a copy was cut under, taken when it is copied: the readback's cut is made of it. */
type Captured = { uniforms: SelectionUniforms; worldRevision: number }

/** The fewest ranks of each list a copy after the first takes. */
const ASIDE_LEAST_RANKS = 1024

/** Bytes of a copy of `ranks` ranks of each list (`aside.ts`, `copyLists`): the requests and the
 *  drawn list, a header each, then the requests' priorities and their page counts. */
export const asideCopyBytes = (ranks: number) => (2 * listWords(ranks) + 2 * ranks) * 4

/** What a copy of a view's lists was: `ranks` of each list out of a list of `listCap`, the cut
 *  `serial` of `captured`, under the withdrawals in place when its encoder was submitted
 *  (`DagRuntimeState.withdrawnRevision`). */
export type AsideCopy = {
  ranks: number
  listCap: number
  captured: Captured
  serial: number
  withdrawn: number
}

/** What a view aside's reads follow (`createAsideSlots`). */
type AsideState = {
  copied: number
  inFlight: number
  whole: number
  last: GpuCut | null
  pending: Promise<unknown>
  disposed: boolean
}

/** A view aside's readbacks (`createAsideSlots`). */
export type AsideSlots = ReturnType<typeof createAsideSlots>

/**
 * The readbacks of a view aside (`aside.ts`): a ring of `DAG_READBACK_SLOTS` buffers
 * (`../../gpu/core/readbackRing.ts`), each made again larger when a copy needs it, read one after the
 * other behind the view's reads in flight (`pending`). `copied` is the ranks of each list the next
 * copy takes — the whole list until a readback says more —; `inFlight` the cut whose copy is being
 * read, `whole` the last cut read back whole: a cut in neither is owed a copy.
 */
export function createAsideSlots(resources: DagResources, state: DagRuntimeState, view: number) {
  const scratch = Array.from({ length: DAG_READBACK_SLOTS }, createDagOutputScratch)
  let reads = 0
  const slots: AsideState = {
    copied: Infinity,
    inFlight: -1,
    whole: -1,
    last: null,
    pending: Promise.resolve(),
    disposed: false,
  }
  /** `copy` read, or dropped: its cut no longer in flight. */
  const settled = (copy: AsideCopy) => {
    if (copy.serial === slots.inFlight) slots.inFlight = -1
  }
  const own = { resources, state, view, slots }
  const ring = createReadbackRing<AsideCopy>(
    resources.device,
    {
      label: 'Trillion3D DAG aside readback',
      bytes: asideCopyBytes(0),
      count: DAG_READBACK_SLOTS,
      chain(read, copy) {
        // A mapping cut short by `dispose` or refused: the next copy tries again. Any other error
        // is the engine's: it surfaces.
        void behind(slots, () =>
          read()
            .catch(unlessRefused)
            .finally(() => settled(copy)),
        )
      },
    },
    (range, _staging, copy) => readAsideSlot(own, range, copy, scratch[reads++ % scratch.length]),
  )
  return Object.assign(slots, { ring, settled })
}

/** A copy mapped (the ring's `read`), parsed into `scratch`: the next copy sized by what the cut
 *  asked, and the readback adopted when it holds the whole cut on the residency in place. */
function readAsideSlot(
  own: {
    resources: DagResources
    state: DagRuntimeState
    view: number
    slots: AsideState
  },
  range: ArrayBuffer,
  read: AsideCopy,
  scratch: DagOutputScratch,
) {
  const { resources, state, slots } = own,
    { ranks, listCap } = read,
    drawn = listWords(ranks)
  const { parsed, demand } = readDagSlot(
    range,
    {
      bytes: asideCopyBytes(ranks),
      drawnWordOffset: drawn,
      priorityWordOffset: 2 * drawn,
      countWordOffset: 2 * drawn + ranks,
      scratch,
    },
    { feedback: resources.listFeedback, caps: resources.listCaps },
  )
  // The next copy follows what the cut asks, twice it, within the list.
  if (demand > slots.copied || 4 * demand < slots.copied)
    slots.copied = clamp(2 * demand, ASIDE_LEAST_RANKS, listCap)
  // Lists copied short of the cut are copied again at their size; a page withdrawn since may be
  // named by them, which the mask no longer draws: the next cut will. A cut past the readout's
  // list is read by its head (`../cut/adoption/adoption.ts`).
  const whole = demand <= ranks || ranks === listCap
  // Read whole: no copy of this cut is owed any more.
  if (parsed && whole) slots.whole = read.serial
  if (parsed && whole && read.withdrawn === state.withdrawnRevision) {
    const { uniforms, worldRevision } = read.captured
    slots.last = { uniforms, worldRevision, result: parsed }
    // Every page its mask draws is in its journal: the swap can bring it back.
    if (!parsed.truncated) noteWhole(resources.swap, own.view, read.serial)
  }
}
