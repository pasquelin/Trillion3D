import {
  FRUSTUM_PLANE_VALUES,
  axisAngleQuaternion,
  composeMatrix4,
  frustumFarPlane,
  frustumPlanesFromMatrix,
  matrixAtRenderOrigin,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts'
import { PREFETCH_HORIZON_MS } from '../../backend/common.ts'
import type { CameraMotion } from '../../camera/world.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

/**
 * The VIEW AHEAD of a moving camera, in its render frame (`./selection.ts`): what the cut also
 * evaluates to request the pages the camera will need before they are on screen
 * (`../dag/shader/aheadWgsl.ts`).
 *
 * - `view` is the camera moved by its velocity and turned by its turn over the horizon
 *   (`CameraMotion.horizonMs`, else the published `PREFETCH_HORIZON_MS`): the view whose screen
 *   error ranks and selects what is asked for — a turning camera judges detail along the way it will
 *   look, not at the edge of the way it looks now. The velocity is the one smoothed for it
 *   (`CameraMotion.ahead`), the eye's otherwise. Neither extrapolates longer than it has held
 *   (`CameraMotion.steadyMs`, `turnSteadyMs`): a one-frame jump — a cut — sends the view ahead no
 *   further than the jump, and none once the camera is still.
 * - `planes` hold BOTH frusta, the current one and the one ahead, and the GUARD BAND the camera
 *   turns into meanwhile: each side plane is opened by the angle it turns over the horizon, then
 *   every plane is pushed out by the distance it travels towards it. Nothing is tuned: the horizon
 *   is the published time to full detail, the rest is the camera's own motion. An orthographic
 *   projection is only pushed, its sides have no angle to open.
 */
export type AheadView = { planes: Float32Array; view: Float32Array }

const projection = new Float64Array(16),
  clip = new Float64Array(16),
  planes = new Float64Array(FRUSTUM_PLANE_VALUES),
  back = new Float64Array(3),
  turned = new Float64Array(16),
  rotation = new Float64Array(16),
  quaternion = new Float64Array(4)
const ORIGIN = [0, 0, 0],
  UNIT = [1, 1, 1]

/** A projection scale `cot(half field)` opened by `turn` radians; a field past the half turn takes
 *  zero, and its side planes keep only what is in front of the eye. */
function opened(scale: number, turn: number) {
  const half = Math.atan(1 / Math.abs(scale)) + turn
  return half >= Math.PI / 2 ? 0 : Math.sign(scale) / Math.tan(half)
}

/** Writes the view ahead of `cam` into `into`, or returns null for a camera that neither moves nor
 *  turns: its cut is then the one of before, bit for bit. */
export function aheadViewOf(cam: EngineCamera, motion: CameraMotion, into?: AheadView | null) {
  const velocity = motion.ahead ?? motion.velocity,
    horizonMs = motion.horizonMs ?? PREFETCH_HORIZON_MS,
    moved = Math.min(horizonMs, motion.steadyMs ?? horizonMs) / 1000,
    turn = (motion.turn ?? 0) * (Math.min(horizonMs, motion.turnSteadyMs ?? horizonMs) / 1000)
  const dx = (velocity?.[0] ?? 0) * moved,
    dy = (velocity?.[1] ?? 0) * moved,
    dz = (velocity?.[2] ?? 0) * moved
  if (!(dx || dy || dz || turn > 0)) return null
  const out = into ?? {
    planes: new Float32Array(FRUSTUM_PLANE_VALUES),
    view: new Float32Array(16),
  }
  const view = cam.viewRelative
  projection.set(cam.projection)
  if (cam.perspective > 0 && turn > 0) {
    projection[0] = opened(projection[0], turn)
    projection[5] = opened(projection[5], turn)
  }
  multiplyMatrix4(clip, projection, view)
  frustumPlanesFromMatrix(planes, clip)
  frustumFarPlane(planes, 16, view, cam.far, true)
  for (let i = 0; i < 6; i++) {
    const toward = -(planes[i * 4] * dx + planes[i * 4 + 1] * dy + planes[i * 4 + 2] * dz)
    if (toward > 0) planes[i * 4 + 3] += toward
  }
  out.planes.set(planes)
  // The eye turned by `q` about itself and moved by `d` sees the world through `view · q⁻¹ · T(-d)`.
  turned.set(view)
  if (turn > 0 && motion.axis) {
    axisAngleQuaternion(quaternion, motion.axis, -turn)
    composeMatrix4(rotation, ORIGIN, quaternion, UNIT)
    multiplyMatrix4(turned, view, rotation)
  }
  back[0] = -dx
  back[1] = -dy
  back[2] = -dz
  matrixAtRenderOrigin(out.view, turned, back)
  return out
}

/** Views ahead a holder no longer carries, kept for its next move: a stop drops none. */
const spare = new WeakMap<object, AheadView>()
/** Writes `holder`'s view ahead in place — the one it holds, else the one it held before a stop. */
export function holdAheadView(
  holder: { ahead?: AheadView | null },
  cam: EngineCamera,
  motion?: CameraMotion,
) {
  const kept = holder.ahead ?? spare.get(holder)
  holder.ahead = motion ? aheadViewOf(cam, motion, kept) : null
  if (kept) spare.set(holder, kept)
}

export const copyAheadView = (a?: AheadView | null): AheadView | null =>
  a ? { planes: a.planes.slice(), view: a.view.slice() } : null
