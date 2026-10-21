import { noteFileSlots, writeKeyRecords, writeMovedKeyRecords } from '../keyRecords.ts'
import { BLEND_ORDER_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { BlendExpand } from './expand.ts'
import type { WebgpuBlendState } from '../state.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { GpuSelection } from '../../gpu/core/selection.ts'
import { FRAME_HEAD } from '../frame/frameHead.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'

/**
 * What the GPU verdict reads, sent where it moved: the plan with every key record, or the key
 * records noted stale since (`noteKeyRecord`) — each one in a cell file once a file's slot moved
 * (`noteFileSlots`); the frustum planes, compared with those the last verdict judged; and where the
 * cut's cold words hold the world's cell and file words, which the verdict reads itself
 * (`cellDraws`): a switch rewrites no record. Each move counts in `verdictEpoch`, under which the
 * verdict's counts come back (`../verdict/verdictRead.ts`) — a switch only while a transmissive
 * item lies in a cell file, the in-view count then following it.
 */
function sendVerdictInputs(
  blendState: WebgpuBlendState,
  expand: BlendExpand,
  cut: GpuSelection | undefined,
) {
  const world = cut?.world,
    states = cut?.cellStates,
    slots = world?.fileSlot
  noteFileSlots(blendState, world, world?.slotRevision ?? -1)
  if (blendState.planMoved) {
    expand.uploadPlan({
      seeds: blendState.seeds,
      counts: { entries: blendState.seeds.length, runs: blendState.slotCount, instanceBase: 0 },
      region: blendState.planRegion,
      scene: blendState,
      stepWords: blendState.orderStepWords,
      keyWords: writeKeyRecords(blendState, slots, states?.instances),
    })
    blendState.planMoved = false
    blendState.verdictEpoch++
  } else {
    const moved = writeMovedKeyRecords(blendState, slots, states?.instances)
    if (moved) {
      expand.uploadKeys(moved.first, moved.words)
      blendState.verdictEpoch++
    }
  }
  if (!sameValues(blendState.blendPlanes, blendState.judgedPlanes)) {
    blendState.judgedPlanes.set(blendState.blendPlanes)
    blendState.verdictEpoch++
  }
  const revision = world?.revision ?? -1
  if (revision !== blendState.cellRevision) {
    blendState.cellRevision = revision
    if (blendState.cellTransmits) blendState.verdictEpoch++
  }
  blendState.frameWords[FRAME_HEAD.cellStates] = states?.base ?? 0
  blendState.frameWords[FRAME_HEAD.cellCount] = states?.cells ?? 0
  blendState.frameWords[FRAME_HEAD.fileStates] = states?.files ?? 0
}

/**
 * Whether no distortion can be drawn this image: the counts an image judged under the same inputs
 * came back with no transmissive item in view (`VERDICT_IN_VIEW`): without a refracting surface in view
 * the distortion would only copy the scene onto itself.
 * An image with any input moved since draws it, and the GPU's depth test decides what it covers.
 * The CPU never waits for the answer: until one comes back for the current inputs, it is drawn.
 */
export const noTransmissiveInView = ({ expand, verdictEpoch }: WebgpuBlendState) =>
  !!expand && expand.counts.epoch === verdictEpoch && expand.counts.inView === 0

/**
 * What the image asks of the kernels: the verdict's inputs where they moved and the frame data,
 * then in ONE compute pass the frustum verdict of every item (`../verdict/verdictWgsl.ts`) and the pass's
 * order and expansion; then the verdict's counts to the readback.
 *
 * Dispatches of the same compute pass are ordered and see the previous writes: the expansion reads
 * the keep words the verdict wrote.
 */
export function encodeBlendExpansion(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { blendState } = rt,
    expand = blendState.expand,
    { runCount, seeds } = blendState
  if (!expand) return
  // No slot to draw: a frame without an eye paints nothing (`../order/order.ts`).
  if (!runCount) return
  // An item drawn only while its cell file or its row's HLOD 0 cell draws its placements
  // (`cellDraws`).
  const cut = rt.run.gpuSelection
  sendVerdictInputs(blendState, expand, cut)
  expand.uploadFrame(blendState.frameWords, blendState.frameLayout.words)
  expand.clearVerdict(encoder)
  const pass = encoder.beginComputePass({ label: BLEND_ORDER_PASS })
  expand.judge(pass, cut?.cellStates?.view)
  expand.encode(pass, blendState.orderSteps, { entries: seeds.length, runs: runCount })
  pass.end()
  expand.readCounts(encoder, blendState.verdictEpoch)
}
