/**
 * THE COMPUTE THROTTLE (`throttleWgsl.ts` holds its kernels; the options are described in
 * `docs/SHADOWS.md`). The throttled cull counts the clusters it draws in each map, the frame keeps the
 * counts, and the next frame's two kernels, run before its marking, carry them to its maps and add
 * their levels to the maps' bias in the projection records.
 *
 * What the CPU holds is the kernels' parameters and the buffers of the two frames that take turns by
 * the set's parity (`vsmFrameParity`): made on the first throttled frame, freed with the set. Off,
 * nothing here is made, written or run.
 */
import { FLOAT32_MAX } from '../../../../../math/src/constants.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { saturate } from '../../../../../math/src/scalar/reals.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { markWrittenOnGpu, writeChanged } from '../../../gpu/core/writeChanged.ts'
import { grownByCopy } from '../../../gpu/core/tableGrowth.ts'
import { VSM_PASS_PREFIX } from '../../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { VSM_PROJECTION_RECORD_BYTES } from './constants.ts'
import type { VsmFrame } from './frame/vsmProject.ts'
import { STORAGE } from './render/renderLists.ts'
import { vsmFeedbackWords } from './render/renderParamsWgsl.ts'
import { vsmFrameParity, vsmFrameSetHeld, vsmPerFrameSet } from './resources.ts'
import type { VsmPerFrameSet, VsmResources } from './resources.ts'
import {
  VSM_THROTTLE_PARAMS,
  VSM_THROTTLE_PROCESS_ENTRY,
  VSM_THROTTLE_PROCESS_WGSL,
  VSM_THROTTLE_UPDATE_ENTRY,
  VSM_THROTTLE_UPDATE_WGSL,
  vsmThrottleWords,
} from './throttleWgsl.ts'

/** Whether the settings ask the throttle: a time budget or a load budget above 0. */
export const vsmThrottled = (shadows: ShadowValues) =>
  shadows.shadowDynamicResolutionTimeBudgetMs > 0 || shadows.shadowDynamicResolutionLoadBudget > 0

const LABEL = `${VSM_PASS_PREFIX}throttle`

/** The kernels, once a device, compiled off the thread. */
const processKernel = autoKernel(
  `${LABEL}.process`,
  VSM_THROTTLE_PROCESS_WGSL,
  VSM_THROTTLE_PROCESS_ENTRY,
)
const updateKernel = autoKernel(
  `${LABEL}.update`,
  VSM_THROTTLE_UPDATE_WGSL,
  VSM_THROTTLE_UPDATE_ENTRY,
)

/** The kernels as stages of the chain a frame waits for before it runs the throttle. */
export const vsmThrottleStages = (device: GPUDevice) => [
  processKernel(device),
  updateKernel(device),
]

/** The throttle's buffers of a set: the two frames' that take turns, a frame writing the pair of its
 *  parity (`vsmFrameParity`), the other being the previous frame's — the feedback (the clusters each map
 *  drew, written by the raster) and the throttle buffer (the counts carried to the new ids and the
 *  intensities). */
export interface VsmThrottleState {
  device: GPUDevice
  mapSlots: number
  /** The words of the feedback of `mapSlots` maps. */
  feedbackWords: number
  feedback: [GPUBuffer, GPUBuffer]
  throttle: [GPUBuffer, GPUBuffer]
  params: GPUBuffer
  paramU32: Uint32Array<ArrayBuffer>
  paramF32: Float32Array<ArrayBuffer>
  /** The most levels the throttle may add to a sun's maps and to a local light's, rewritten by each frame. */
  maxBiases: [number, number]
  pipelines: { process: GPUComputePipeline; update: GPUComputePipeline }
  /** Whether the previous frame ran the throttle and kept its maps: its pair is there to read. */
  prevKept: boolean
  /** Whether this frame cleared its pair, i.e. runs the throttle. */
  active: boolean
  groups: { process: VsmPerFrameSet<GPUBindGroup>; update: VsmPerFrameSet<GPUBindGroup> }
}

/** Every buffer the state holds. */
const buffersOf = (held: VsmThrottleState) => [...held.feedback, ...held.throttle, held.params]

/** The throttle's buffers of `res`: the ones it holds, or made now, sized by the set's map slots. A
 *  change of the slots makes them again, the previous frame's pair carried over
 *  (`carryVsmThrottle`). For a frame the plan found the throttle's programs compiled for (the plan's
 *  `throttleReady`). */
export function vsmThrottleState(device: GPUDevice, res: VsmResources): VsmThrottleState {
  const mapSlots = res.layout.mapSlots
  const held = res.throttle
  if (held?.mapSlots === mapSlots) return held
  const made = makeVsmThrottle(device, mapSlots)
  if (held) carryVsmThrottle(held, made, 1 - vsmFrameParity(res))
  return (res.throttle = made)
}

/** The throttle's buffers for `mapSlots` map slots, holding no frame. */
function makeVsmThrottle(device: GPUDevice, mapSlots: number): VsmThrottleState {
  const feedbackWords = vsmFeedbackWords(mapSlots),
    throttleWords = vsmThrottleWords(mapSlots)
  const buffer = (name: string, words: number, usage = STORAGE()) =>
    device.createBuffer({ label: `${LABEL}.${name}`, size: 4 * words, usage })
  const paramData = new ArrayBuffer(4 * VSM_THROTTLE_PARAMS.words)
  return {
    device,
    mapSlots,
    feedbackWords,
    feedback: [buffer('feedback0', feedbackWords), buffer('feedback1', feedbackWords)],
    throttle: [buffer('buffer0', throttleWords), buffer('buffer1', throttleWords)],
    params: buffer(
      'params',
      VSM_THROTTLE_PARAMS.words,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    ),
    paramU32: new Uint32Array(paramData),
    paramF32: new Float32Array(paramData),
    maxBiases: [0, 0],
    pipelines: {
      process: processKernel(device).get()!,
      update: updateKernel(device).get()!,
    },
    prevKept: false,
    active: false,
    groups: { process: vsmFrameSetHeld(), update: vsmFrameSetHeld() },
  }
}

/** The slots of the throttle changed, the buffers of `from` replaced by those of `to`: the pair of
 *  the previous frame (`previous`, a parity) copied whole into the new one, whose words of each map
 *  stand where they stood (`vsmFeedbackWords`, `vsmThrottleWords`), and the previous frame still the
 *  next one's previous (`prevKept`). The buffers of `from` are retired after the copy. A pair that
 *  does not fit the new buffers is not copied in part, the process kernel would read past its end:
 *  nothing is carried and the history restarts. */
function carryVsmThrottle(from: VsmThrottleState, to: VsmThrottleState, previous: number) {
  const pairs = (['feedback', 'throttle'] as const).map(
    (key) => [from[key][previous], to[key][previous]] as const,
  )
  const fits = pairs.every(([old, grown]) => grown.size >= old.size)
  grownByCopy(
    from.device,
    buffersOf(from),
    fits
      ? (encoder) => {
          for (const [old, grown] of pairs) encoder.copyBufferToBuffer(old, 0, grown, 0, old.size)
        }
      : undefined,
    `${LABEL}.carry`,
  )
  to.prevKept = fits && from.prevKept
}

/** Frees the throttle's buffers of `res`, with the set. */
export function releaseVsmThrottle(res: VsmResources) {
  const held = res.throttle
  if (!held) return
  for (const buffer of buffersOf(held)) buffer.destroy()
  res.throttle = undefined
}

/** Bytes the throttle's buffers of `res` hold. */
export const vsmThrottleBytes = (res: VsmResources) =>
  res.throttle ? buffersOf(res.throttle).reduce((sum, buffer) => sum + buffer.size, 0) : 0

/** The frame begins: its pair cleared before the raster counts. */
export function clearVsmThrottle(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  held: VsmThrottleState,
) {
  const pair = vsmFrameParity(res)
  encoder.clearBuffer(held.feedback[pair])
  encoder.clearBuffer(held.throttle[pair])
  held.active = true
}

/** The frame is done (`keepVsmFrame`): where it ran the throttle and kept its maps, the next frame
 *  reads its pair; else it has no previous buffers and skips the kernels. */
export function keepVsmThrottle(
  res: { throttle?: Pick<VsmThrottleState, 'prevKept' | 'active'> },
  mapsGranted: boolean,
) {
  const held = res.throttle
  if (!held) return
  held.prevKept = mapsGranted && held.active
  held.active = false
}

/** Gives the render-scale controller the time budget `budgetMs` of the shadow raster, every frame
 *  (the main view asks it, the views beside it share what it learnt), and returns the throttle's
 *  strength: what the controller gives up of the raster's fraction, 0 to 1; −1 where no time budget is
 *  named. */
export function askVsmThrottleStrength(rt: WebgpuPagesRuntime, budgetMs: number) {
  const { views } = rt,
    { vsm } = views.main.scale
  const fraction = views.active === views.main ? vsm.ask(budgetMs) : vsm.now
  return budgetMs > 0 ? saturate(1 - fraction) : -1
}

/** The most levels the throttle may add to a sun's maps and to a local light's, into `into`: the lower
 *  of the dynamic resolution's limit and the kind's own cap, less the pool's bias `pressureBias` (what
 *  that bias took of the limit is not the throttle's), never under 0. */
function vsmThrottleMaxBiases(shadows: ShadowValues, pressureBias: number, into: [number, number]) {
  const limit = shadows.shadowDynamicResolutionMaxResolutionLodBias
  const most = (cap: number) => Math.max(0, Math.min(limit, cap) - pressureBias)
  into[0] = most(shadows.shadowDynamicResolutionMaxComputeResolutionLodBiasDirectional)
  into[1] = most(shadows.shadowDynamicResolutionMaxComputeResolutionLodBiasLocal)
  return into
}

/** The kernels' parameters into `held.params`; no load budget is the greatest finite one. */
function writeParameters({ device, vsm, plan, strength }: VsmFrame, held: VsmThrottleState) {
  const { shadows } = vsm.state.maps,
    { paramU32: u, paramF32: f } = held,
    at = VSM_THROTTLE_PARAMS.at
  const load = shadows.shadowDynamicResolutionLoadBudget
  const [directional, local] = vsmThrottleMaxBiases(
    shadows,
    vsm.state.cache.pressureBias,
    held.maxBiases,
  )
  u[at.nextCount] = plan.nextMapCount
  u[at.slotCount] = plan.projectionCount
  f[at.strength] = strength
  f[at.loadBudget] = load > 0 ? load : FLOAT32_MAX
  f[at.historyWeight] = shadows.shadowDynamicResolutionPerVsmBiasHistoryWeight
  f[at.maxBiasDirectional] = directional
  f[at.maxBiasLocal] = local
  writeChanged(device, held.params, u, 0, VSM_THROTTLE_PARAMS.words)
}

/** The group of a kernel: `label`, its pipeline, and the buffers of its bindings in order — the
 *  parameters, the previous pair's, this frame's, what else it reads — for the parity of the set. */
const kernelGroup =
  (
    label: string,
    pipelineOf: (held: VsmThrottleState) => GPUComputePipeline,
    bindings: (
      held: VsmThrottleState,
      res: VsmResources,
      now: 0 | 1,
      before: number,
    ) => GPUBuffer[],
  ) =>
  (res: VsmResources, held: VsmThrottleState) => {
    const now = vsmFrameParity(res)
    return held.device.createBindGroup({
      label: `${LABEL}.${label}`,
      layout: pipelineOf(held).getBindGroupLayout(0),
      entries: sequentialEntries(bindings(held, res, now, 1 - now).map((buffer) => ({ buffer }))),
    })
  }

/** The process kernel's: the previous pair's throttle buffer and feedback, the next-map data by
 *  previous id, this frame's throttle buffer. */
const processGroup = kernelGroup(
  'process',
  (held) => held.pipelines.process,
  (held, res, now, before) => [
    held.params,
    held.throttle[before],
    held.feedback[before],
    res.nextMaps,
    held.throttle[now],
  ],
)

/** The update kernel's: the previous pair's throttle buffer, this frame's, and the projection data
 *  it adds the bias to. */
const updateGroup = kernelGroup(
  'update',
  (held) => held.pipelines.update,
  (held, res, now, before) => [
    held.params,
    held.throttle[before],
    held.throttle[now],
    res.current.projectionData,
  ],
)

/**
 * The two kernels into `pass`, process then update, before the marking: the previous frame's counts
 * carried to this frame's ids (`nextMaps` names where each previous id went), then the intensities
 * fitted and added to the projection data's bias. None on a frame with no previous frame's buffers
 * (the first, one after a frame that kept nothing or did not throttle). The projection data is marked
 * written on the GPU: the next upload of this buffer sends it whole.
 */
export function encodeVsmThrottle(pass: GPUComputePassEncoder, frame: VsmFrame) {
  const { vsm, plan, throttle: held } = frame
  if (!held?.prevKept) return
  const { res } = vsm
  writeParameters(frame, held)
  // Every previous id is a thread; thread 0 also writes the totals, so one workgroup at least.
  pass.setPipeline(held.pipelines.process)
  pass.setBindGroup(0, vsmPerFrameSet(held.groups.process, res, processGroup, held, res.nextMaps))
  pass.dispatchWorkgroups(Math.max(1, ceilDiv(plan.nextMapCount, WORKGROUP_THREADS)))
  pass.setPipeline(held.pipelines.update)
  pass.setBindGroup(0, vsmPerFrameSet(held.groups.update, res, updateGroup, held, res.nextMaps))
  pass.dispatchWorkgroups(Math.max(1, ceilDiv(plan.projectionCount, WORKGROUP_THREADS)))
  const written = (plan.projectionCount * VSM_PROJECTION_RECORD_BYTES) / 4
  markWrittenOnGpu(res.current.projectionData, written)
}
