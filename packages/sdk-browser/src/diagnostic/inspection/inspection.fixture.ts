import { createEngineCamera, writeEngineCamera } from '../../camera/engineCamera.ts'

/** An engine camera at `eye` looking down −z, 90° wide and square. */
export function cameraAt(eye: number[]) {
  const cam = createEngineCamera()
  cam.world.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, eye[0], eye[1], eye[2], 1])
  return writeEngineCamera(cam, { fov: 90, aspect: 1, near: 0.5, far: 1000, zoom: 1 })
}
