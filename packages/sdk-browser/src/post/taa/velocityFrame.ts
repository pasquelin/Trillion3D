import { sameMatrixBits } from '../../../../math/src/matrix/matrixElements.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { WebgpuGpuState } from '../../frame/backend/state/gpu.ts'
import { screenProbesCast } from '../../lighting/bounce/screen/cast.ts'
import { encodeComposedMotion } from '../../placement/compose/composedMotionPass.ts'
import { tessellationWanted } from '../../visibility/tessellation/wanted.ts'
import { motionWanted, perObjectSizeOf } from '../effects/stagePlan.ts'
import type { TaaFrameState } from './frameState.ts'
import type { VelocityInputs } from './inputs.ts'
import { askVelocityProgram, createVelocity, type Velocity } from './velocity.ts'
import { writeTaaView } from './view.ts'

/**
 * THE VELOCITY STAGE OF THE IMAGE, once before the lighting: the motion of every render texel,
 * measured once and read by every pass that needs it — the indirect light, the temporal pass, the
 * motion blur. A view holds one stage (`velocityOf`) as soon as a pass reads it, and every image
 * asks whether one does (`readsVelocity`, `followVelocity`): the stage is then drawn
 * (`encodeVelocity`) and the placements' motion it measures with is decided (`trackMotion`), once,
 * for all of them.
 */

/** Whether a pass other than the temporal pass reads this image's vectors: the motion blur or the
 *  screen probes (`screenProbesCast`). */
const readsVelocity = (rt: WebgpuPagesRuntime) => motionWanted(rt) || screenProbesCast(rt)

/** The view's velocity stage, made at the first ask. */
export const velocityOf = (
  gpu: Pick<WebgpuGpuState, 'velocity'>,
  device: GPUDevice,
  roots: WebgpuPagesRuntime['layout']['selectionRoots'],
) => (gpu.velocity ??= createVelocity(device, roots))

/** Asks the stage's program, off the frame, once a pass reads the vectors — the temporal pass, once
 *  rigged, or another —: the frame is held on it, never compiling it. */
export function askVelocity(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.gpu.temporal || readsVelocity(rt)) askVelocityProgram(device)
}

/**
 * The image's entry for the velocity stage: whether a pass reads this image's vectors — the
 * temporal pass `taa` where it runs, or another. Read, the stage is made where the view has none;
 * not read, the target it holds is given back.
 */
export function followVelocity(rt: WebgpuPagesRuntime, taa: boolean) {
  const { gpu } = rt,
    wanted = taa || readsVelocity(rt)
  const velocity =
    gpu.velocity ??
    (wanted && gpu.device ? velocityOf(gpu, gpu.device, rt.layout.selectionRoots) : undefined)
  if (!velocity) return
  if (velocity.active && !wanted) velocity.release()
  velocity.active = wanted
  velocity.measured = false
}

/**
 * The placements' motion of this image, decided once for the stage that owns it: a restart without
 * history, a compared image when the scene moved since the last one (`scan`), else one kept; the
 * linked placements' motion, which the GPU composes, follows the same decision
 * (`encodeComposedMotion`). Returns `scan`.
 */
function trackMotion(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  { frame, motion }: Velocity,
) {
  const scan = frame.sceneSeen !== rt.run.gate.revisions.scene
  if (!frame.hasHistory) motion.reset()
  else motion.update(cam.eye, scan)
  encodeComposedMotion(rt, device, encoder, cam.eye, frame.hasHistory, scan)
  return scan
}

/** Whether the image shows what the last one did: its history kept, the scene, the resources, the
 *  placements and the deformations as they were, and the camera where it stood. A still image adds
 *  to the count the temporal pass's convergence is told by, and has no motion to blur; any motion
 *  starts it again. */
const imageStill = (
  rt: WebgpuPagesRuntime,
  state: TaaFrameState,
  cam: EngineCamera,
  scan: boolean,
  moved: boolean,
) =>
  state.hasHistory &&
  !scan &&
  rt.run.gate.revisions.resources === state.resourcesSeen &&
  !moved &&
  !rt.vis.deformationCompute &&
  sameMatrixBits(state.previousViewProjection, cam.viewProjection)

/** Keeps this image, drawn on the `render` grid, as the one the next is measured against: the
 *  scene and resources it saw, the camera's view and eye, the grid. The last pass that reads the
 *  last image's view does it (`encodeVelocity`, `encodeTaaPass`). */
export function keepImage(
  rt: WebgpuPagesRuntime,
  state: TaaFrameState,
  cam: EngineCamera,
  render: readonly number[],
) {
  state.sceneSeen = rt.run.gate.revisions.scene
  state.previousViewProjection.set(cam.viewProjection)
  state.previousEye.set(cam.eye)
  state.previousRender[0] = render[0]
  state.previousRender[1] = render[1]
  state.resourcesSeen = rt.run.gate.revisions.resources
  state.hasHistory = true
}

/**
 * Writes into `inputs` what the velocity passes read of the frame — its depth, identifiers and page
 * records, the placements' `motion`, the pools and the normal atlas a deformed or displaced pixel's
 * triangle is read from and the roots' world boxes; false, with nothing written, while the frame lacks any of them.
 */
export function readVelocityInputs(
  rt: WebgpuPagesRuntime,
  inputs: VelocityInputs,
  velocity: Velocity,
): boolean {
  const { gpu, vis } = rt,
    pool = gpu.cache?.buffer
  if (!gpu.depthView || !vis.visView || !vis.pageTable) return false
  if (!pool || !vis.concatPos || !vis.concatUv || !vis.concatNrm) return false
  inputs.depth = gpu.depthView
  inputs.ids = vis.visView
  inputs.pages = vis.pageTable
  inputs.motion = velocity.motion.buffer
  inputs.boxes = velocity.boxes(rt.rootWorlds)
  inputs.pool = pool
  inputs.positions = vis.concatPos
  inputs.uvs = vis.concatUv
  inputs.normals = vis.concatNrm
  return true
}

/** What the stage reads of the frame, rewritten by each image: an image allocates none. */
const inputs = {} as VelocityInputs

/**
 * Draws the velocity stage of this image, before the lighting, in the image's encoder: the
 * placements' motion decided and written, the uniform, then the vectors of every render texel
 * (`velocity.vectors`). Nothing where no pass reads them (`followVelocity`) or the frame lacks what
 * the stage reads. Where the temporal pass does not run, the image is kept here as the one the next
 * is measured against; where it runs, it keeps it after its own use of the last image's view.
 */
export function encodeVelocity(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, vis } = rt,
    velocity = gpu.velocity
  if (!velocity?.active || !readVelocityInputs(rt, inputs, velocity)) return
  const state = velocity.frame
  velocity.ensure(...gpu.allocatedSize)
  const scan = trackMotion(rt, device, encoder, cam, velocity)
  state.objectSize = perObjectSizeOf(rt)
  state.tessellated = tessellationWanted(rt)
  const moved = velocity.motion.moved || !!rt.compose?.moving
  const grids = [gpu.targetSize, gpu.displaySize, velocity.size] as const
  writeTaaView(
    device,
    velocity.uniform,
    state,
    cam,
    ...grids,
    moved,
    false,
    !!vis.deformationCompute,
  )
  velocity.encode(encoder, inputs, gpu.targetSize)
  rt.run.gpuDrawCalls++
  velocity.scan = scan
  velocity.moved = moved
  velocity.still = imageStill(rt, state, cam, scan, moved)
  velocity.measured = true
  if (!gpu.temporal?.frame.active) keepImage(rt, state, cam, gpu.targetSize)
}

/** Whether the last image drawn carried motion its blur showed: a quiet view is drawn once more,
 *  its motion nil, or it would stay blurred. */
export const velocitySettling = (rt: WebgpuPagesRuntime) => {
  const velocity = rt.gpu.velocity
  return !!velocity?.active && !velocity.still
}
