import type { GpuCut, SelectionUniforms } from '../core/selection.ts'
import { createDagOutputScratch, type DagOutputScratch } from './uniforms.ts'
import { DAG_READBACK_SLOTS, SELECTION_HEADER_WORDS } from './layout.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { DagResources } from './resources.ts'
import { noteWhole } from './swap.ts'
import { recutView } from './runtimeState.ts'
import { createCoarsening, type Coarsening } from './coarsening.ts'
import { readDagSlot } from './readbackSlot.ts'
import { createReadbackRing, ReadbackRefused } from '../core/readbackRing.ts'
import { widerFlagShape } from './queueGrowth.ts'
import { ADMISSION_BUCKETS } from './request.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** What a copy was cut under, taken when it is copied: the readback's cut is made of it, and the
 *  factor its threshold was cut under (`coarsening.ts`). */
type Captured = { uniforms: SelectionUniforms; worldRevision: number; coarsen: number }

/** The fewest ranks of each list a copy after the first takes. */
const ASIDE_LEAST_RANKS = 1024

/** What a copy of a view's lists was: `ranks` of each list out of a list of `listCap`, the cut
 *  `serial` of `captured`, on the residency in place when its encoder was submitted. */
export type AsideCopy = {
  ranks: number
  listCap: number
  captured: Captured
  serial: number
  residency: number
}

/** What a view aside's reads follow (`createAsideSlots`). */
type AsideState = {
  copied: number
  inFlight: number
  whole: number
  last: GpuCut | null
  coarse: Coarsening
  pending: Promise<unknown>
  disposed: boolean
}

/** A view aside's readbacks (`createAsideSlots`). */
export type AsideSlots = ReturnType<typeof createAsideSlots>

/**
 * The readbacks of a view aside (`aside.ts`): a ring of `DAG_READBACK_SLOTS` buffers
 * (`../core/readbackRing.ts`), each made again larger when a copy needs it, read one after the
 * other behind the view's reads in flight (`pending`). `copied` is the ranks of each list the next
 * copy takes — the whole list until a readback says more —; `inFlight` the cut whose copy is being
 * read, `whole` the last cut read back whole: a cut in neither is owed a copy. `coarse` is what the
 * factor the view's threshold is cut under follows, its own as the main view's is
 * (`coarsening.ts`).
 */
export function createAsideSlots(resources: DagResources, state: DagRuntimeState, view: number) {
  const scratch = Array.from({ length: DAG_READBACK_SLOTS }, createDagOutputScratch)
  let reads = 0
  const slots: AsideState = {
    copied: Infinity,
    inFlight: -1,
    whole: -1,
    last: null,
    coarse: createCoarsening(),
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
      bytes: 2 * SELECTION_HEADER_WORDS * 4 + ADMISSION_BUCKETS * 4,
      count: DAG_READBACK_SLOTS,
      chain(read, copy) {
        slots.pending = slots.pending
          .catch(() => {})
          .then(async () => {
            try {
              await read()
            } catch (error) {
              // A mapping cut short by `dispose` or refused: the next copy tries again. Any other
              // error is the engine's: it surfaces.
              if (!(error instanceof ReadbackRefused)) throw error
            } finally {
              settled(copy)
            }
          })
      },
    },
    (range, _staging, copy) => readAsideSlot(own, range, copy, scratch[reads++ % scratch.length]),
  )
  return Object.assign(slots, { ring, settled })
}

/** A copy mapped (the ring's `read`), parsed into `scratch`: the next copy sized by what the cut
 *  asked, a cut past its list grown, and the readback adopted when it holds the whole cut on the
 *  residency in place. */
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
    drawn = SELECTION_HEADER_WORDS + ranks
  const { parsed, demand, grown, grownFlags, moved, retried } = readDagSlot(
    range,
    {
      bytes: drawn * 8 + ADMISSION_BUCKETS * 4,
      drawnWordOffset: drawn,
      listCap,
      scratch,
      levelsWord: 2 * drawn,
    },
    {
      limits: resources.device.limits,
      heldSlots: resources.heldSlots,
      pageCount: resources.pageCount,
      listFull: state.listFull,
      coarse: slots.coarse,
      cutFactor: read.captured.coarsen,
      flags: {
        shape: resources.flagShape,
        entryCount: resources.entryCount,
        full: state.flagsFull,
      },
    },
  )
  // The next copy follows what the cut asks, twice it, within the list.
  if (demand > slots.copied || 4 * demand < slots.copied)
    slots.copied = clamp(2 * demand, ASIDE_LEAST_RANKS, listCap)
  // A cut past its list grows it, as the main cut's does (`listCap.ts`).
  if (grown) state.grow = Math.max(state.grow, grown)
  // A cut that dropped work grows the queues or lists it filled, as the main cut's does
  // (`queueGrowth.ts`), and is never adopted.
  if (grownFlags) state.growFlags = widerFlagShape(state.growFlags, grownFlags)
  // Past the device, its cut coarsens and the view cuts again, its truncated readout adopted
  // never; the factor follows the readouts cut under it alone.
  if (moved) recutView(resources.swap, own.view)
  if (retried && (!grown || parsed?.dropped)) return
  // Lists copied short of the cut are copied again at their size; a residency moved since names
  // pages the mask no longer draws: the next cut will.
  const whole = demand <= ranks || ranks === listCap
  // Read whole on a list that stays: no copy of this cut is owed any more.
  if (parsed && whole && !grown) slots.whole = read.serial
  if (parsed && whole && read.residency === state.residencyRevision) {
    const { uniforms, worldRevision } = read.captured
    slots.last = { uniforms, worldRevision, result: parsed }
    // Every page its mask draws is in its journal: the swap can bring it back.
    if (!parsed.truncated) noteWhole(resources.swap, own.view, read.serial)
  }
}
