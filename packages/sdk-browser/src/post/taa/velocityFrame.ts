import { velocityWpo } from './velocityWpo.ts'
import { sameMatrixBits } from '../../../../math/src/matrix/matrixElements.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { WebgpuGpuState } from '../../frame/backend/state/gpu.ts'
import { screenProbesCast } from '../../lighting/bounce/screen/cast.ts'
import { tessellationWanted } from '../../visibility/tessellation/wanted.ts'
import { motionWanted } from '../effects/stagePlan.ts'
import {
  cameraSeen,
  NO_CAMERA,
  previousCameraOf,
} from '../../frame/backend/state/previousCamera.ts'
import { dropTaaHistory } from './landing.ts'
import type { TaaFrameState } from './frameState.ts'
import type { VelocityInputs } from './inputs.ts'
import { askVelocityProgram, createVelocity } from './velocity.ts'
import { writeTaaView } from './view.ts'
import type { WpoSet } from '../../materials/graph/wpoProgram.ts'

/**
 * THE VELOCITY STAGE OF THE IMAGE, once before the lighting: the motion of every render texel,
 * measured once and read by every pass that needs it — the indirect light, the temporal pass, the
 * motion blur. A view holds one stage (`velocityOf`) as soon as a pass reads it, and every image
 * asks whether one does (`readsVelocity`, `followVelocity`): the stage is then drawn
 * (`encodeVelocity`), once for all of them, the placements' motion read from the cut's poses now
 * and as the last drawn frame drew them (`../../geometry/dag/previousPoses.ts`).
 */

/** Whether a pass other than the temporal pass reads this image's vectors: the motion blur or the
 *  screen probes (`screenProbesCast`). */
const readsVelocity = (rt: WebgpuPagesRuntime) => motionWanted(rt) || screenProbesCast(rt)

/** The view's velocity stage, made at the first ask. */
export const velocityOf = (
  gpu: Pick<WebgpuGpuState, 'velocity'>,
  device: GPUDevice,
  wpo?: WpoSet,
) => (gpu.velocity ??= createVelocity(device, wpo))

/** Asks the stage's program, off the frame, once a pass reads the vectors — the temporal pass, once
 *  rigged, or another —: the frame is held on it, never compiling it. An image that draws displaced
 *  surfaces (`tessellationWanted`) asks the programs that solve their flat points, the temporal
 *  pass's analysis' included; any other asks none of them. */
export function askVelocity(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { temporal } = rt.gpu,
    tessellated = tessellationWanted(rt)
  if (temporal || readsVelocity(rt))
    askVelocityProgram(device, tessellated, velocityWpo(rt.vis.rasters))
  if (temporal && tessellated) temporal.askDisplaced()
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
    (wanted && gpu.device ? velocityOf(gpu, gpu.device, velocityWpo(rt.vis.rasters)) : undefined)
  if (!velocity) return
  if (velocity.active && !wanted) velocity.release()
  velocity.active = wanted
  velocity.measured = false
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
  state.before.image > 0 &&
  sameMatrixBits(state.before.viewProjection, cam.viewProjection)

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
  state.seen = rt.run.frame
  state.previousRender[0] = render[0]
  state.previousRender[1] = render[1]
  state.resourcesSeen = rt.run.gate.revisions.resources
  state.hasHistory = true
}

/**
 * Writes into `inputs` what the velocity passes read of the frame — its depth, identifiers and page
 * records, the placements' poses now and as the last drawn frame drew them, the pools and the normal atlas a deformed or displaced pixel's
 * triangle is read from; false, with nothing written, while the frame lacks any of them.
 */
export function readVelocityInputs(rt: WebgpuPagesRuntime, inputs: VelocityInputs): boolean {
  const { gpu, vis } = rt,
    pool = gpu.cache?.buffer,
    selection = rt.run.gpuSelection
  if (!gpu.depthView || !vis.visView || !vis.pageTable || !selection) return false
  if (!pool || !vis.concatPos || !vis.concatUv || !vis.concatNrm) return false
  inputs.depth = gpu.depthView
  inputs.ids = vis.visView
  inputs.pages = vis.pageTable
  inputs.worlds = selection.worlds
  inputs.previous = selection.previous
  inputs.pool = pool
  inputs.positions = vis.concatPos
  inputs.uvs = vis.concatUv
  inputs.normals = vis.concatNrm
  // The records that hold the values of the offsets the stage places a pixel's triangle by, and the
  // frame they are evaluated at.
  const material = vis.materialTable.view
  if (!material || !gpu.device) return false
  inputs.material = material
  inputs.frame = vis.graphFrame.bufferOn(gpu.device)
  // The colour atlas an offset reads a texture from.
  if (!vis.textures || !vis.mapsSampler) return false
  inputs.textures = vis.textures
  inputs.sampler = vis.mapsSampler
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
  if (!velocity?.active || !readVelocityInputs(rt, inputs)) return
  const state = velocity.frame
  // The history's camera: the view's, kept once, where the history's image is the one before. A history that skipped an image
  // holds a camera no one kept, and starts again, as after a cut.
  state.before = cameraSeen(previousCameraOf(rt), state.seen) ?? NO_CAMERA
  if (state.hasHistory && !state.before.image) dropTaaHistory(state)
  velocity.ensure(...gpu.allocatedSize)
  const scan = state.sceneSeen !== rt.run.gate.revisions.scene
  // The placements' motion is measured from the scene's kept poses (`../../geometry/dag/previousPoses.ts`),
  // the last drawn frame's, whichever view drew it: a view drawn less often keeps its history.
  const moved = rt.run.gpuSelection!.posesMoving
  state.tessellated = tessellationWanted(rt)
  const grids = [gpu.targetSize, gpu.displaySize, velocity.size] as const
  writeTaaView(
    device,
    velocity.uniform,
    state,
    cam,
    ...grids,
    moved,
    false,
    !!vis.deformationCompute || vis.rasters.offsets.length > 0,
  )
  // Its program, flat or displaced as `tessellationWanted` says, was asked at the frame's entry (`askVelocity`).
  velocity.encode(encoder, inputs, gpu.targetSize, state.tessellated)
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
