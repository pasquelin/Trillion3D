import type { GpuCut, SelectionUniforms } from '../core/selection.ts'
import { createDagOutputScratch, type DagOutputScratch } from './uniforms.ts'
import { SELECTION_HEADER_WORDS } from './layout.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { createDagResources } from './resources.ts'
import { noteWhole } from './swap.ts'
import { readDagSlot, SlotMapRefused } from './readbackSlot.ts'
import { ADMISSION_BUCKETS } from './request.ts'

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>
/** What a copy was cut under, taken when it is copied: the readback's cut is made of it. */
type Captured = { uniforms: SelectionUniforms; worldRevision: number }

/** The fewest ranks of each list a copy after the first takes. */
const ASIDE_LEAST_RANKS = 1024

/** A view aside's readback slots (`createAsideSlots`). */
export type AsideSlots = ReturnType<typeof createAsideSlots>

/**
 * The readback slots of a view aside (`aside.ts`): two, each made again larger when a copy needs
 * it, read one after the other. `copied` is the ranks of each list the next copy takes — the whole
 * list until a readback says more —; `inFlight` the cut whose copy is being read, `whole` the last
 * cut read back whole: a cut in neither is owed a copy.
 */
export function createAsideSlots(resources: DagResources, state: DagRuntimeState, view: number) {
  const buffers: GPUBuffer[] = []
  const scratch = [createDagOutputScratch(), createDagOutputScratch()]
  const slots = {
    mapped: [false, false],
    next: 0,
    copied: Infinity,
    copiedSerial: [-1, -1],
    inFlight: -1,
    whole: -1,
    last: null as GpuCut | null,
    pending: Promise.resolve() as Promise<unknown>,
    disposed: false,
    /** Slot `i`, made or made again to hold `bytes`. */
    slotOf(i: number, bytes: number) {
      if (buffers[i] && buffers[i].size >= bytes) return buffers[i]
      buffers[i]?.destroy()
      return (buffers[i] = resources.device.createBuffer({
        label: 'Trillion3D DAG aside readback',
        size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }))
    },
    /** Reads slot `i`, `ranks` of each list copied out of a list of `listCap`: the cut `serial` of
     *  `captured`, behind the reads in flight. */
    read(i: number, ranks: number, listCap: number, captured: Captured, serial: number) {
      const read = { i, ranks, listCap, captured, serial, residency: state.residencyRevision }
      slots.pending = slots.pending
        .catch(() => {})
        .then(() => readAsideSlot({ resources, state, view, slots, buffers, scratch }, read))
    },
    /** Slot `i` read, or its copy dropped: free, its cut no longer in flight. */
    dropped(i: number) {
      slots.mapped[i] = false
      if (slots.copiedSerial[i] === slots.inFlight) slots.inFlight = -1
    },
    /** The slots go once the reads in flight are done. */
    release() {
      slots.pending = slots.pending.catch(() => {}).then(() => buffers.forEach((b) => b.destroy()))
    },
  }
  return slots
}

/** Slot `read.i` mapped and parsed: the next copy sized by what the cut asked, a cut past its list
 *  grown, and the readback adopted when it holds the whole cut on the residency in place. */
async function readAsideSlot(
  own: {
    resources: DagResources
    state: DagRuntimeState
    view: number
    slots: AsideSlots
    buffers: GPUBuffer[]
    scratch: DagOutputScratch[]
  },
  read: {
    i: number
    ranks: number
    listCap: number
    captured: Captured
    serial: number
    residency: number
  },
) {
  const { resources, state, slots } = own,
    { i, ranks, listCap } = read,
    drawn = SELECTION_HEADER_WORDS + ranks
  try {
    if (slots.disposed) return
    const { parsed, demand, grown } = await readDagSlot(
      own.buffers[i],
      {
        bytes: drawn * 8 + ADMISSION_BUCKETS * 4,
        drawnWordOffset: drawn,
        listCap,
        scratch: own.scratch[i],
        levelsWord: 2 * drawn,
      },
      { limits: resources.device.limits, pageCount: resources.pageCount, listFull: state.listFull },
    )
    // The next copy follows what the cut asks, twice it, within the list.
    if (demand > slots.copied || 4 * demand < slots.copied)
      slots.copied = Math.min(listCap, Math.max(ASIDE_LEAST_RANKS, 2 * demand))
    // A cut past its list grows it, as the main cut's does (`listCap.ts`).
    if (grown) state.grow = Math.max(state.grow, grown)
    // Lists copied short of the cut are copied again at their size; a residency moved since names
    // pages the mask no longer draws: the next cut will.
    const whole = demand <= ranks || ranks === listCap
    // Read whole on a list that stays: no copy of this cut is owed any more.
    if (parsed && whole && !grown) slots.whole = read.serial
    if (parsed && whole && read.residency === state.residencyRevision) {
      slots.last = { ...read.captured, result: parsed }
      // Every page its mask draws is in its journal: the swap can bring it back.
      if (!parsed.truncated) noteWhole(resources.swap, own.view, read.serial)
    }
  } catch (error) {
    // A mapping cut short by `dispose` or refused: the next copy tries again. Any other error is
    // the engine's: it surfaces.
    if (!(error instanceof SlotMapRefused)) throw error
  } finally {
    slots.dropped(i)
  }
}
