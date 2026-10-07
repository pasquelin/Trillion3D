import * as G from '../../host/graph/graph.fixture.ts'

/** A camera at `(x, 0, z)` looking at `(x, 0, 0)`. */
export function cameraAt(x: number, z: number) {
  const cam = G.perspectiveCamera(55, 1, 0.1, 100)
  cam.position.set(x, 0, z)
  cam.lookAt(x, 0, 0)
  cam.updateMatrixWorld()
  return cam
}
