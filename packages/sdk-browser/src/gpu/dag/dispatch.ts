import {
  copySelectionUniforms,
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type SelectionUniforms,
} from '../core/selection.ts'
import { createDagOutputScratch, writeDagUniforms, parseDagOutput } from './uniforms.ts'
import type { createDagResources } from './resources.ts'
import { encodeDagDifference, encodeDagKernels } from './encode.ts'
import { DAG_READBACK_SLOTS as SLOTS } from './layout.ts'
import { grownListCap, listDemand, queueDagListGrowth } from './listCap.ts'
import type { createDifferenceChain } from './differenceChain.ts'

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>
export type DagRuntimeState = {
  last: GpuCut | null
  lastSubmitted?: SelectionUniforms
  lastReadback?: SelectionUniforms
  pending: Promise<unknown>
  disposed: boolean
  dead: boolean
  worldRevision: number
  residencyRevision: number
  submittedResidencyRevision: number
  readbackResidencyRevision: number
  submittedWorldRevision: number
  readbackWorldRevision: number
  mapped: boolean[]
  slot: number
  /** The list cap a truncated readout asked for, taken once no readback is in flight; 0: none. */
  grow: number
  /** A list being made: no frame cuts until it is in place or refused. */
  growing: boolean
  /** The device refused a larger list: a truncated readout now goes to the host as it is. */
  listFull: boolean
}

export function createDagDispatch(
  resources: DagResources,
  state: DagRuntimeState,
  fail: () => void,
  /** Where a resident cut's readbacks land, every one in the order copied (`differenceChain.ts`). */
  chain: ReturnType<typeof createDifferenceChain>,
): GpuSelection['dispatch'] {
  const { device, packed, residentCut, uniformData, uniforms } = resources
  // One readback slot, one set of arrays: the snapshot rewrites them instead of reallocating.
  // The pair returned to the caller stays new on every readback, so it always distinguishes two
  // snapshots by identity — that is what adoption compares to know if the cut moved.
  const scratch = Array.from({ length: SLOTS }, createDagOutputScratch)
  const dispatch: GpuSelection['dispatch'] = (next, shared) => {
    if (state.disposed || state.dead) return
    // A list to grow waits for the readbacks in flight, and no frame cuts on the old one meanwhile.
    if (state.growing) return
    if (state.grow) {
      if (state.mapped.includes(true)) return
      queueDagListGrowth(resources, state)
      return
    }
    const { output, readback, outputBytes, readbackBytes: copied, listCap } = resources
    const compute =
      !state.lastSubmitted ||
      !sameSelectionUniforms(state.lastSubmitted, next) ||
      state.submittedResidencyRevision !== state.residencyRevision ||
      state.submittedWorldRevision !== state.worldRevision
    const needsReadback =
      !state.lastReadback ||
      !sameSelectionUniforms(state.lastReadback, next) ||
      state.readbackResidencyRevision !== state.residencyRevision ||
      state.readbackWorldRevision !== state.worldRevision
    // The first free slot from the next one in turn, or none.
    let i = -1
    for (let k = 0; k < SLOTS && i < 0; k++) {
      const at = (state.slot + k) % SLOTS
      if (!state.mapped[at]) i = at
    }
    const copy = needsReadback && i >= 0
    if ((!compute && !copy) || (!residentCut && i < 0)) return
    const encoder = shared ?? device.createCommandEncoder()
    // What this call is about to claim, so an abandoned command buffer can give it all back: a copy
    // that never runs would leave its readback slot mapped forever and freeze the cut on its last
    // result, and a compute pass that never runs must not be remembered as submitted.
    const undoSubmitted = state.lastSubmitted,
      undoSubmittedRevision = state.submittedResidencyRevision,
      undoSubmittedWorld = state.submittedWorldRevision
    const undoReadback = state.lastReadback,
      undoReadbackRevision = state.readbackResidencyRevision,
      undoReadbackWorld = state.readbackWorldRevision,
      undoSlot = state.slot
    // A resident cut's copy carries its difference against the snapshot copied before it.
    const differ = copy && residentCut
    if (compute) {
      writeDagUniforms(uniformData, packed, next, residentCut, listCap)
      device.queue.writeBuffer(uniforms, 0, uniformData)
      encodeDagKernels(encoder, resources, differ)
      state.lastSubmitted = copySelectionUniforms(next)
      state.submittedResidencyRevision = state.residencyRevision
      state.submittedWorldRevision = state.worldRevision
    } else if (differ) encodeDagDifference(encoder, resources)
    if (copy) encoder.copyBufferToBuffer(output, 0, readback[i], 0, copied)
    const captured = copy ? copySelectionUniforms(next) : undefined
    const capturedWorldRevision = state.worldRevision,
      capturedResidencyRevision = state.residencyRevision
    if (captured) {
      state.lastReadback = captured
      state.readbackResidencyRevision = state.residencyRevision
      state.readbackWorldRevision = capturedWorldRevision
      state.mapped[i] = true
      state.slot = (i + 1) % SLOTS
    }
    const read = () => {
      if (!captured) return
      state.pending = state.pending
        .catch(() => {})
        .then(async () => {
          try {
            // `dispose` destroyed the buffers: a read queued behind the other slot's maps nothing,
            // since mapping a destroyed buffer is a validation error on the device (#334).
            if (state.disposed) return
            await readback[i].mapAsync(GPUMapMode.READ)
            const bytes = readback[i].getMappedRange(),
              drawnWordOffset = residentCut ? outputBytes / 4 : 0
            const parsed = parseDagOutput(bytes, 0, copied, drawnWordOffset, scratch[i])
            // A cut past the list: the list grows and the next dispatch cuts again, rather than
            // hand the host a truncated readout it could only give up to the CPU cut.
            const grown =
              parsed?.truncated && !state.listFull
                ? grownListCap(
                    device.limits,
                    packed.pageCount,
                    listCap,
                    listDemand(bytes, drawnWordOffset),
                  )
                : undefined
            // A residency that moved since makes the drawable mask a lie. A pose that moved only
            // makes the cut a frame late, as a camera's: it keeps the revision it was cut under.
            const adoptable = !grown && capturedResidencyRevision === state.residencyRevision
            // Every copy a resident cut made lands in the chain, adoptable or not: the next is
            // taken against it.
            if (parsed?.drawablePageIds)
              chain.land(
                new Uint32Array(bytes, 0, copied >>> 2),
                listCap,
                parsed.pageIds.length,
                parsed.drawablePageIds.length,
                adoptable,
              )
            readback[i].unmap()
            if (!parsed) {
              fail()
              return
            }
            if (grown) {
              state.grow = Math.max(state.grow, grown)
              return
            }
            if (adoptable)
              state.last = {
                uniforms: captured,
                result: parsed,
                worldRevision: capturedWorldRevision,
              }
          } catch {
            // A mapping cut short by `dispose` failed nothing, and its buffer is gone.
            if (state.disposed) return
            try {
              readback[i].unmap()
            } catch {
              /* Mapping may already be closed. */
            }
            fail()
          } finally {
            state.mapped[i] = false
          }
        })
    }
    if (shared) {
      let settled = false
      return (submitted: boolean) => {
        if (settled) return
        settled = true
        if (submitted) {
          read()
          return
        }
        state.lastSubmitted = undoSubmitted
        state.submittedResidencyRevision = undoSubmittedRevision
        state.submittedWorldRevision = undoSubmittedWorld
        state.lastReadback = undoReadback
        state.readbackResidencyRevision = undoReadbackRevision
        state.readbackWorldRevision = undoReadbackWorld
        if (captured) {
          state.mapped[i] = false
          state.slot = undoSlot
        }
      }
    }
    device.queue.submit([encoder.finish()])
    read()
    return undefined
  }
  return dispatch
}
