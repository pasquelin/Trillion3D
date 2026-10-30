import { noteFileSlots, writeKeyRecords, writeMovedKeyRecords } from '../keyRecords.ts'
import { BLEND_ORDER_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { BlendExpand } from './expand.ts'
import type { ViewVerdict } from '../verdict/verdictRead.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import type { WebgpuBlendState } from '../state.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { GpuSelection } from '../../gpu/core/selection.ts'
import { FRAME_HEAD } from '../frame/frameHead.ts'
import { planFrameViews } from './expansionViews.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'

const PASS: GPUComputePassDescriptor = { label: BLEND_ORDER_PASS }

/**
 * What the GPU verdict reads, sent where it moved: the plan with every key record, or the key
 * records noted stale since (`noteKeyRecord`) — each one in a cell file once a file's slot moved
 * (`noteFileSlots`); and where the
 * cut's cold words hold the world's cell and file words, which the verdict reads itself
 * (`cellDraws`): a switch rewrites no record. Each move counts in `verdictEpoch`, under which the
 * verdict's counts come back (`../verdict/verdictRead.ts`) — a switch only while a transmissive
 * item lies in a cell file, the in-view count then following it. The frustum is the view's own: its planes are compared
 * with those its last verdict judged (`followVerdict`), so that no other view moves the epoch its counts come back under.
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
      region: blendState.planRegion,
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
  const revision = world?.revision ?? -1
  if (revision !== blendState.cellRevision) {
    blendState.cellRevision = revision
    if (blendState.cellTransmits) blendState.verdictEpoch++
  }
  blendState.frameWords[FRAME_HEAD.cellStates] = states?.base ?? 0
  blendState.frameWords[FRAME_HEAD.cellCount] = states?.cells ?? 0
  blendState.frameWords[FRAME_HEAD.fileStates] = states?.files ?? 0
}

/** Moves the epoch of a view's counts when what its verdict reads moved since its last image: the scene's inputs (`verdictEpoch`), its own planes or its own sky cut (`cutSkyItems`: a cut item drops its bit in the verdict). */
function followVerdict(blendState: WebgpuBlendState, verdict: ViewVerdict) {
  if (verdict.seen !== blendState.verdictEpoch) {
    verdict.seen = blendState.verdictEpoch
    verdict.epoch++
  }
  if (!sameValues(blendState.blendPlanes, verdict.judged)) {
    verdict.judged.set(blendState.blendPlanes)
    verdict.epoch++
  }
  const { cutWords } = blendState
  if (!sameValues(cutWords, verdict.cuts)) {
    verdict.cuts.set(cutWords)
    verdict.epoch++
  }
}

/**
 * Whether no distortion can be drawn in the view of `gpu` this image: the counts its own image judged under the same inputs
 * came back with no transmissive item in view (`VERDICT_IN_VIEW`): without a refracting surface in view
 * the distortion would only copy the scene onto itself.
 * An image with any input moved since draws it, and the GPU's depth test decides what it covers.
 * The CPU never waits for the answer: until one comes back for the current inputs of the view, it is drawn.
 * Each view reads its own counts, judged against its own frustum (a planar view's too); a face of the sky meshes' capture has no slot, reads none and draws.
 */
export const noTransmissiveInView = (blendState: WebgpuBlendState, gpu: { viewKey?: object }) => {
  const verdict = blendState.expand?.peekVerdict(viewKey(gpu))
  return !!verdict && verdict.latest.epoch === verdict.epoch && verdict.latest.inView === 0
}

/**
 * What the image asks of the kernels: the verdict's inputs where they moved and the frame data,
 * then in ONE compute pass the frustum verdict of every item (`../verdict/verdictWgsl.ts`) and the pass's
 * order and expansion; then the verdict's counts to the readback.
 *
 * Dispatches of the same compute pass are ordered and see the previous writes: the expansion reads
 * the keep words the verdict wrote. The main image and each planar view read the counts of their own verdict back, each judging its own
 * frustum and expanding the whole plan from its own camera; `skyOnly`: a face of the sky meshes' capture expands its sky view alone
 * (`planFrameViews`) and reads no counts.
 */
export function encodeBlendExpansion(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  skyOnly = false,
) {
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
  // A face of the sky meshes' capture reads no counts back.
  const verdict = skyOnly
    ? undefined
    : expand.verdictOf(viewKey(rt.gpu), blendState.cutWords.length)
  if (verdict) followVerdict(blendState, verdict)
  expand.uploadFrame(blendState.frameWords, blendState.frameLayout.words)
  expand.uploadCuts(blendState.frameLayout.cuts, blendState.cutWords)
  expand.clearVerdict(encoder)
  // The views the image's draws read: its items' passes, its responsive layers (`expansionViews.ts`).
  planFrameViews(rt, skyOnly)
  const counts = { entries: seeds.length, runs: runCount }
  blendState.frameViews.forEach((frameView, at) => {
    if (frameView.active)
      expand.uploadView(
        at,
        frameView,
        blendState.maxPlanEntries,
        counts,
        blendState.planRegion,
        blendState,
      )
  })
  const pass = encoder.beginComputePass(PASS)
  expand.judge(pass, cut?.cellStates?.view)
  expand.encode(pass, blendState.orderSteps, counts, blendState.frameViews)
  pass.end()
  if (verdict) expand.readCounts(encoder, verdict)
}
