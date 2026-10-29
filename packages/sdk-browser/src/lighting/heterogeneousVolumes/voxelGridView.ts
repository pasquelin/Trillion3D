import { frustumPlanesFromMatrix } from '../../../../math/src/geometry/frustum/frustum.ts'
import type { FrameContext } from './liveShadingContext.ts'
import { frameView } from './liveShadingContext.ts'
import { outwardFrustumPlanes, viewFrustumCorners, type GridView } from './voxelGrid/gridPlan.ts'

const unit = (m: ArrayLike<number>, at: number): [number, number, number] => {
  const length = Math.hypot(m[at], m[at + 1], m[at + 2]) || 1
  return [m[at] / length, m[at + 1] / length, m[at + 2] / length]
}

/** The camera the grids are cut for (`GridView`): its place and axes, its field of view, the view's size and the planes of its frustum, inward for the
 *  plan and outward for the pass that sizes the voxels. `frameView` holds the inverse of the matrix the depth was drawn with. */
export function gridViewOf(c: FrameContext) {
  const { cam } = c
  const [width, height] = c.rt.gpu.targetSize
  const inward = new Float64Array(24)
  frustumPlanesFromMatrix(inward, cam.viewProjection)
  const view: GridView = {
    origin: [cam.eye[0], cam.eye[1], cam.eye[2]],
    right: unit(cam.world, 0),
    up: unit(cam.world, 4),
    forward: [frameView.forward[0], frameView.forward[1], frameView.forward[2]],
    fovDegrees: cam.fov,
    width,
    height,
    planes: inward,
  }
  return {
    view,
    orthographic: cam.perspective !== 1,
    outwardPlanes: outwardFrustumPlanes(viewFrustumCorners(frameView.inverse)),
  }
}
