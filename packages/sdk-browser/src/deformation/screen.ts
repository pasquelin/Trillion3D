import { focalPixels } from '../../../math/src/projection/camera.ts'
import { worldStretch } from '../page/cut/logic.ts'
import { screenErrorBound } from '../../../sdk-core/src/lod/screenErrorBound.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import { viewDepthOf, viewLateralOf } from '../page/selection/projection.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { ClusterRoot } from '../page/selection/types.ts'
import type { PageRec } from '../page/selection/selection.ts'

type Roots = readonly ClusterRoot<PageRec>[]

/** How many pixels `reach` of root's units spans at worst, seen from `cam`: from the nearest point
 *  of its rest box the reach can bring closer. */
function pixelsOf(root: ClusterRoot<PageRec>, reach: number, cam: EngineCamera, focal: number) {
  const box = root.worldBox
  if (!box) return Infinity
  const x = (box[0] + box[3]) / 2,
    y = (box[1] + box[4]) / 2,
    z = (box[2] + box[5]) / 2
  return screenErrorBound(
    reach * worldStretch(root),
    1,
    viewLateralOf(x, y, z, cam.view),
    viewDepthOf(x, y, z, cam.view),
    length3(box[3] - x, box[4] - y, box[5] - z),
    focal,
    cam.near,
    cam.perspective,
  )
}

/**
 * The screen-size threshold of the deformation stage: the engine skips a deformed
 * object too small to show it: `skippedBy(roots, cam, viewport, error)` gives the frame's
 * `skipped(i, reach)` (`frame.ts`), true when root `i`'s reach spans less than the image's pixel
 * error — it is then drawn at rest, as a coarser cluster would be. One closure, made once: a frame
 * allocates nothing.
 */
export function createDeformationSkip() {
  let roots: Roots = [],
    cam: EngineCamera | undefined,
    focal = 0,
    threshold = 0
  const skipped = (i: number, reach: number) =>
    threshold > 0 && !!roots[i] && pixelsOf(roots[i], reach, cam!, focal) < threshold
  return (
    frameRoots: Roots,
    frameCam: EngineCamera,
    viewport: readonly number[] | undefined,
    pixelError: number,
  ) => {
    roots = frameRoots
    cam = frameCam
    threshold = pixelError
    focal = focalPixels(cam.projection, viewport?.[0], viewport?.[1])
    return skipped
  }
}
