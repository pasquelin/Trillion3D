import type { CameraPose } from '../../../sdk-core/src/contracts/base.ts'
import type { MeasuredWorldOptions, PointOfInterest } from '../session/options.ts'
import type { ViewCamera } from '../camera/world.ts'

type Inputs = {
  options: MeasuredWorldOptions
  camera: ViewCamera
  center: ViewCamera['position']
}

/** A point of interest the host declared whole: an id, a label and a pose. */
const declaredPoint = (point: PointOfInterest) =>
  point && typeof point.id === 'string' && typeof point.label === 'string' && !!point.pose

/** The session's poses: where it looks from, and the points of interest the host declared. The
 *  camera's controller is the world's (`world.controls`), never the session's. */
export function createExplorerCameraApi({ options, camera, center }: Inputs) {
  const homePose = (): CameraPose => ({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [center.x, center.y, center.z],
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  })
  return {
    pointsOfInterest: (): PointOfInterest[] => [
      { id: 'home', label: 'Home', pose: homePose() },
      ...(options.pointsOfInterest ?? []).filter(declaredPoint),
    ],
    homePose,
  }
}
