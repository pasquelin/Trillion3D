import {
  FRUSTUM_PLANE_VALUES,
  frustumFarPlane,
  frustumPlanesFromMatrix,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import { PREFETCH_HORIZON_MS } from '../../backend/common.ts';
import type { CameraMotion } from '../../camera/world.ts';
import type { EngineCamera } from '../../camera/engineCamera.ts';

/**
 * The VIEW AHEAD of a moving camera, in its render frame (`./selection.ts`): what the cut also
 * evaluates to request the pages the camera will need before they are on screen (#488,
 * `../dag/shader/aheadWgsl.ts`).
 *
 * - `view` is the camera moved by its velocity over the horizon (`PREFETCH_HORIZON_MS`): the view
 *   whose screen error ranks and selects what is asked for.
 * - `planes` hold BOTH frusta, the current one and the one ahead, and the GUARD BAND the camera
 *   turns into meanwhile: each side plane is opened by the angle it turns over the horizon, then
 *   every plane is pushed out by the distance it travels towards it. Nothing is tuned: the horizon
 *   is the published time to full detail, the rest is the camera's own motion. An orthographic
 *   projection is only pushed, its sides have no angle to open.
 */
export type AheadView = { planes: Float32Array; view: Float32Array };

const projection = new Float64Array(16),
  clip = new Float64Array(16),
  planes = new Float64Array(FRUSTUM_PLANE_VALUES);

/** A projection scale `cot(half field)` opened by `turn` radians; a field past the half turn takes
 *  zero, and its side planes keep only what is in front of the eye. */
function opened(scale: number, turn: number) {
  const half = Math.atan(1 / Math.abs(scale)) + turn;
  return half >= Math.PI / 2 ? 0 : Math.sign(scale) / Math.tan(half);
}

/** Writes the view ahead of `cam` into `into`, or returns null for a camera that neither moves nor
 *  turns: its cut is then the one of before, bit for bit. */
export function aheadViewOf(cam: EngineCamera, motion: CameraMotion, into?: AheadView | null) {
  const velocity = motion.velocity,
    horizon = PREFETCH_HORIZON_MS / 1000,
    turn = (motion.turn ?? 0) * horizon;
  const dx = (velocity?.[0] ?? 0) * horizon,
    dy = (velocity?.[1] ?? 0) * horizon,
    dz = (velocity?.[2] ?? 0) * horizon;
  if (!(dx || dy || dz || turn > 0)) return null;
  const out = into ?? {
    planes: new Float32Array(FRUSTUM_PLANE_VALUES),
    view: new Float32Array(16),
  };
  const view = cam.viewRelative;
  projection.set(cam.projection);
  if (cam.perspective > 0 && turn > 0) {
    projection[0] = opened(projection[0], turn);
    projection[5] = opened(projection[5], turn);
  }
  multiplyMatrix4(clip, projection, view);
  frustumPlanesFromMatrix(planes, clip);
  frustumFarPlane(planes, 16, view, cam.far, true);
  for (let i = 0; i < 6; i++) {
    const toward = -(planes[i * 4] * dx + planes[i * 4 + 1] * dy + planes[i * 4 + 2] * dz);
    if (toward > 0) planes[i * 4 + 3] += toward;
  }
  out.planes.set(planes);
  out.view.set(view);
  for (let row = 0; row < 3; row++)
    out.view[12 + row] =
      view[12 + row] - (view[row] * dx + view[4 + row] * dy + view[8 + row] * dz);
  return out;
}

export function sameAheadView(a?: AheadView | null, b?: AheadView | null) {
  if (!a || !b) return !a === !b;
  for (let i = 0; i < 16; i++) if (a.view[i] !== b.view[i]) return false;
  for (let i = 0; i < a.planes.length; i++) if (a.planes[i] !== b.planes[i]) return false;
  return true;
}

export const copyAheadView = (a?: AheadView | null): AheadView | null =>
  a ? { planes: a.planes.slice(), view: a.view.slice() } : null;
