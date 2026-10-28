import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The image number of a history that was never drawn (`cameraSeen`): not an image number, which starts at 0. */
export const NEVER_SEEN = -1

/** A camera as an image drew it: its view-projection without jitter, its eye, and the number of the image (`WebgpuRun.frame`)
 *  that drew with it; `NEVER_SEEN` for none. */
export interface CameraImage {
  readonly viewProjection: Float64Array
  readonly eye: Float64Array
  image: number
}

/** A camera no image drew with: zeros, as a history that holds none reprojects by. */
export const NO_CAMERA: CameraImage = Object.freeze({
  viewProjection: new Float64Array(16),
  eye: new Float64Array(3),
  image: NEVER_SEEN,
})

const newImage = (image: number): CameraImage => ({
  viewProjection: new Float64Array(16),
  eye: new Float64Array(3),
  image,
})

/** The two cameras a view keeps: the image begun and the one before; one pair for each view, so a side view's image
 *  never shifts the main view's. */
interface CameraPair {
  now: CameraImage
  before: CameraImage
}
const pairs = new WeakMap<object, CameraPair>()

/**
 * THE CAMERA OF THE IMAGE BEFORE, kept for each view: a history that reprojects — the temporal
 * pass's, the sky light's occlusion's, the horizon occlusion's — reads it instead of keeping the
 * last camera itself. Each of them notes the number of the image it was last drawn at (`seen`) and
 * reads this camera only where that is the image before (`cameraSeen`): a history that skipped an
 * image holds a camera no one kept, and starts again as after a cut. Called once for each image drawn,
 * before the first pass that reads it (`encodeSurfaceLighting`); a second call for the same image
 * changes nothing.
 */
export function beginCamera(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  let pair = pairs.get(rt.views.active)
  if (!pair)
    pairs.set(rt.views.active, (pair = { now: newImage(NEVER_SEEN), before: newImage(NEVER_SEEN) }))
  const { now, before } = pair
  if (now.image === rt.run.frame) return
  before.viewProjection.set(now.viewProjection)
  before.eye.set(now.eye)
  before.image = now.image
  now.viewProjection.set(cam.viewProjection)
  now.eye.set(cam.eye)
  now.image = rt.run.frame
}

/** The active view's camera of the image before the one begun, `NO_CAMERA` before any. */
export const previousCameraOf = (rt: Pick<WebgpuPagesRuntime, 'views'>): CameraImage =>
  pairs.get(rt.views.active)?.before ?? NO_CAMERA

/** `before` where it is the camera of the image `seen`, a history's last: `undefined` for a history that holds none
 *  (`seen` `NEVER_SEEN`) or one that skipped an image since. */
export const cameraSeen = (before: CameraImage, seen: number) =>
  seen !== NEVER_SEEN && before.image === seen ? before : undefined
