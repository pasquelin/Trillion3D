import type { EngineCamera } from '../../camera/engineCamera.ts'
import { readCutSetting as cutSetting } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { hasClipPlane, NO_CLIP_PLANE } from '../../../../sdk-core/src/contracts/viewOptions.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * WHETHER THE DRAWN VIEW CLIPS, for every pass that draws geometry beside the cut: the project
 * switch is on (`cutClipPlane`, read once when the session opens, `WebgpuPagesSetup.clipping`) and
 * the view's camera has a plane (`Camera.clipPlane`,
 * `../../../../sdk-core/src/contracts/viewOptions.ts`). A view that does not clip holds a zero
 * plane, which the programs made for the switch keep whole.
 */
function viewClips(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  // A stand-in camera no frame entry made (a bench's) carries no set, hence no plane.
  const set = cam.viewSet as EngineCamera['viewSet'] | undefined
  return !!set && hasClipPlane(set.clipPlane) && !!rt.setup.clipping
}

/** Whether the cut culls by the view's plane (`cutClipPlaneCulling`) while it clips: the cut's cull then
 *  hands a cluster that reaches behind it to the hardware raster
 *  (`../../geometry/dag/shader/clipPlaneWgsl.ts`, `straddlesClipPlane`, `clipRoute`). */
export const viewClipRoutes = (rt: WebgpuPagesRuntime, cam: EngineCamera) =>
  viewClips(rt, cam) && cutSetting(rt, 'cutClipPlaneCulling')

/**
 * The view's plane written as four words at `at` of `out`, in the world, for a shader that keeps
 * what `dot(xyz, p) + w` leaves at least 0: the unit normal, then the offset the other way round
 * (`ClipPlaneValues` keeps `n · p - w`). Four zeros for a view that does not clip: a shader then
 * clips nothing, a distance of zero being kept. Returns whether the view clips.
 */
export function writeViewClipPlane(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  out: { [index: number]: number },
  at: number,
) {
  const clips = viewClips(rt, cam),
    plane = clips ? cam.viewSet.clipPlane : NO_CLIP_PLANE
  out[at] = plane[0]
  out[at + 1] = plane[1]
  out[at + 2] = plane[2]
  out[at + 3] = 0 - plane[3]
  return clips
}

/** The view's plane as `writeViewClipPlane` writes it, in a scratch the caller reads at once: for a
 *  draw that takes its plane whole (`../../particles/gpu/webgpuParticleDraw.ts`). */
const scratch = new Float64Array(4)
export function viewClipPlane(rt: WebgpuPagesRuntime, cam: EngineCamera): ArrayLike<number> {
  writeViewClipPlane(rt, cam, scratch, 0)
  return scratch
}

/** The view's plane at `at` of `out` with the offset taken to the eye (`cam.eye`) — `dot(normal,
 *  eye)` added to the offset `writeViewClipPlane` writes, in double precision, so that a reader
 *  measures from the eye whatever the distance to the world's origin: the fog's
 *  (`../../lighting/fog/viewSlots.ts`) and the cut's, whose frame the eye is the origin of
 *  (`cutViewSet.ts`). Four zeros for a view that does not clip; returns whether it clips. */
export function writeViewClipPlaneAtEye(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  out: { [index: number]: number },
  at: number,
) {
  // In double precision whatever `out` holds, rounded once on the way out.
  const clips = writeViewClipPlane(rt, cam, scratch, 0),
    { eye } = cam
  scratch[3] += scratch[0] * eye[0] + scratch[1] * eye[1] + scratch[2] * eye[2]
  for (let k = 0; k < 4; k++) out[at + k] = scratch[k]
  return clips
}
