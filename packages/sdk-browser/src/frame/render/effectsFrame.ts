import { families } from '../../session/host/families.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { ResolveFrame, ResolveTemporal } from '../../post/effects/webgpuKinds.ts'
import type { PlanStage } from '../../post/effects/stagePlan.ts'
import type { Velocity } from '../../post/taa/velocity.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { cpuNow } from '../../diagnostic/stopwatch.ts'

/** The world's effect chain on the GPU, made at the first image that needs it once its code
 *  arrived (`../../session/host/families.ts`); none before. */
export function webgpuEffects(rt: WebgpuPagesRuntime, device: GPUDevice) {
  return (rt.gpu.effects ??= families.effects
    .get()
    ?.createWebgpuEffects(
      device,
      (error) => rt.diag.diagnosticFailure('effects-unavailable', error),
      rt.gpu.kindSettings,
    ))
}

/** What the passes on the lit and on the resolved image read of the frame, rewritten by each image: an
 *  image allocates none. */
export const resolveFrame = {} as ResolveFrame
/** The camera those passes read, and what they know of the temporal pass, rewritten by each image. */
const resolveCamera = {
  projection: [] as ArrayLike<number>,
  perspective: true,
  near: 0,
  exposure: 1,
}
const jitter: [number, number] = [0, 0]
/** The slots the frame's rank is taken in, the view's frame counter modulo them: a pass's noise turns
 *  through eight patterns, whether the image is accumulated in time or not. */
const FRAME_SLOTS = 8
const resolveTemporal: ResolveTemporal = { active: false, cut: false, jitter, slot: 0 }

/** What the passes before the temporal pass know of its accumulation of this image: whether it runs
 *  and its motion is measured, so they may stabilise what they make; whether its history describes
 *  nothing; the jitter this image was drawn with, `y` down; and the frame's rank among eight, whether
 *  the image is accumulated or not. */
function readTemporal(rt: WebgpuPagesRuntime, velocity: Velocity | undefined, before: boolean) {
  const state = rt.gpu.temporal?.frame
  const accumulates = before && !!state?.active && !!velocity
  resolveTemporal.active = accumulates
  resolveTemporal.cut = accumulates && !state.hasHistory
  jitter[0] = accumulates ? state.jitter[0] : 0
  jitter[1] = accumulates ? -state.jitter[1] : 0
  resolveTemporal.slot = rt.run.frame % FRAME_SLOTS
}

/** What the passes of a stage on the lit or the resolved image read of the image: its own size — the
 *  display's after the temporal resolve, else the lit image's, drawn in the top-left of textures of the
 *  largest size —, the grid the motion was measured at, the motion the velocity stage measured, the
 *  camera, the exposure and the session the kinds' settings are read from. */
export function readResolveFrame(
  frame: ResolveFrame,
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  stage: PlanStage,
  atDisplay: boolean,
  velocity: Velocity | undefined,
) {
  const { gpu } = rt
  frame.size = atDisplay ? gpu.displaySize : gpu.targetSize
  frame.resolved = atDisplay
  frame.extent = atDisplay ? gpu.displaySize : gpu.allocatedSize
  frame.display = gpu.displaySize
  frame.render = gpu.targetSize
  frame.depth = gpu.depthView!
  frame.session = rt.context
  frame.now = cpuNow()
  resolveCamera.projection = cam.projection
  resolveCamera.perspective = cam.perspective !== 0
  resolveCamera.near = cam.near
  resolveCamera.exposure = preExposureOf(rt).shown
  frame.camera = resolveCamera
  readTemporal(rt, velocity, stage === 'before-resolve')
  frame.temporal = resolveTemporal
  if (!velocity) return
  frame.allocated = velocity.size
  frame.vectors = velocity.vectors
  frame.view = velocity.uniform
  frame.still = velocity.still
}
