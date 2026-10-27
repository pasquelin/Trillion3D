/**
 * THE ORIGIN AN ORTHOGRAPHIC VIEW'S CLIPMAPS ARE CENTRED ON. A perspective view is centred on its
 * eye. An orthographic camera can stand far from what it shows, so with `shadowOrthoProjectViewOrigin`
 * the origin moves from the eye onto the view's target (`VsmCameraInput.viewTarget`, an offset from
 * the eye): the camera's own, or, where it names none, the first body its line of sight meets
 * (`shadowOrthoRayCastViewOrigin`). The frame resolves both, and the gates of the two settings and
 * of the camera's kind, into the one offset (`frame/vsmViewOrigin.ts`), zero for none.
 */
import type { VsmCameraInput } from './clipmap.ts'

/** The origin, in the world, of the clipmaps of `camera`'s view, into `out`: the eye, moved by the
 *  view's target. */
export function viewOrigin(out: Float64Array, camera: VsmCameraInput) {
  for (let k = 0; k < 3; k++) out[k] = camera.eye[k] + (camera.viewTarget?.[k] ?? 0)
  return out
}
