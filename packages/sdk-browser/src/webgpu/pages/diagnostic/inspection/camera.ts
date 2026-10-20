import { invertMatrix4 } from '../../../../../../math/src/matrix/matrix4Inverse.ts'
import {
  transformHomogeneousPoint,
  writeNormalizedVector3,
} from '../../../../../../math/src/vector/vector.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { InspectedCamera } from './types.ts'

/** What an inspection reads of a camera: its matrices, eye, depth range and kind. */
export type InspectedView = Pick<
  EngineCamera,
  'view' | 'viewProjection' | 'eye' | 'near' | 'far' | 'perspective'
>

/** The clip depths of the near plane and of a plane past it: the engine's depth is reversed, its
 *  far plane at infinity (`../../../../camera/depthConvention.ts`), so the near plane is at 1. */
const NEAR_DEPTH = 1,
  PAST_DEPTH = 0.5
/** The near plane's corners in clip x, y: left-bottom, right-bottom, right-top, left-top. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1]

const homogeneous = new Float64Array(4)

/** The world point of clip `(x, y, z)` through `inverse`, the inverse view-projection, written to
 *  `out[at..at + 2]`. */
export function unprojectInto(
  out: Float64Array | Float32Array,
  at: number,
  inverse: Float64Array,
  x: number,
  y: number,
  z: number,
) {
  transformHomogeneousPoint(homogeneous, inverse, x, y, z)
  const w = homogeneous[3]
  for (let k = 0; k < 3; k++) out[at + k] = homogeneous[k] / w
  return out
}

/** The unit direction the view looks along: its third row, negated. */
export const viewForward = (view: ArrayLike<number>): [number, number, number] => {
  const forward: [number, number, number] = [0, 0, 0]
  writeNormalizedVector3(forward, 0, -view[2], -view[6], -view[10])
  return forward
}

/** `cam`'s frustum in the world: its near corners and the unit direction of each edge from them. */
export function inspectedCamera(cam: InspectedView): InspectedCamera {
  const inverse = invertMatrix4(new Float64Array(16), cam.viewProjection)
  const nearCorners = new Float64Array(12),
    edges = new Float64Array(12),
    past = new Float64Array(3)
  for (let corner = 0; corner < 4; corner++) {
    const x = CORNERS[2 * corner],
      y = CORNERS[2 * corner + 1],
      at = 3 * corner
    unprojectInto(nearCorners, at, inverse, x, y, NEAR_DEPTH)
    unprojectInto(past, 0, inverse, x, y, PAST_DEPTH)
    writeNormalizedVector3(
      edges,
      at,
      past[0] - nearCorners[at],
      past[1] - nearCorners[at + 1],
      past[2] - nearCorners[at + 2],
    )
  }
  return {
    eye: [cam.eye[0], cam.eye[1], cam.eye[2]],
    forward: viewForward(cam.view),
    nearCorners,
    edges,
    near: cam.near,
    far: cam.far,
    perspective: cam.perspective === 1,
  }
}
