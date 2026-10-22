import type { EngineCamera } from '../../camera/engineCamera.ts'
import { CUT_RULES } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { hasClipPlane } from '../../../../sdk-core/src/contracts/viewOptions.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The cut's setting `field` the session holds (`cutOptions.ts`), by its one resolver. */
const cutSetting = contextReader(CUT_RULES)

/**
 * WHETHER AND WHERE THE DRAWN VIEW CLIPS, for every pass that draws geometry beside the cut: the
 * host allows planes (`cutClipPlane`) and the view's camera has one (`Camera.clipPlane`,
 * `../../../../sdk-core/src/contracts/viewOptions.ts`). The one reading of the two, for the
 * rasters, the blends, the particles and the temporal jitter alike.
 */
export function viewClips(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  // A stand-in camera no frame entry made (a bench's) carries no set, hence no plane.
  const set = cam.viewSet as EngineCamera['viewSet'] | undefined
  return !!set && hasClipPlane(set.clipPlane) && cutSetting(rt, 'cutClipPlane')
}

/** Whether the cut culls by the view's plane (`cutClipPlaneCulling`): the split then hands a
 *  cluster that reaches behind it to the hardware raster (`../../visibility/raster/binWgsl.ts`). */
export const clipPlaneCulls = (rt: WebgpuPagesRuntime) => cutSetting(rt, 'cutClipPlaneCulling')

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
    [x, y, z, w] = clips ? cam.viewSet.clipPlane : [0, 0, 0, 0]
  out[at] = x
  out[at + 1] = y
  out[at + 2] = z
  out[at + 3] = 0 - w
  return clips
}

/** The view's plane as `writeViewClipPlane` writes it, in a scratch the caller reads at once: for a
 *  draw that takes its plane whole (`../../particles/gpu/webgpuParticleDraw.ts`). */
const scratch = new Float64Array(4)
export function viewClipPlane(rt: WebgpuPagesRuntime, cam: EngineCamera): ArrayLike<number> {
  writeViewClipPlane(rt, cam, scratch, 0)
  return scratch
}
