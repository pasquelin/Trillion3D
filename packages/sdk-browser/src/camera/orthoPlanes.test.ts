// An orthographic view's planes (`readCameraWorld`): the near and far plane worked out from its box,
// angle, framed point and picture (`autoOrthoPlanes`), then its origin moved onto the near plane
// (`correctOrthoPlanes`), in that order. The expected numbers are worked by hand from those steps, in
// centimetres, with the view's true forward for the reference's `ViewForward` (a defect of its
// `AutoCalculateOrthoPlanes`: it reads the third column of the camera's rotation matrix, the up axis
// of the camera, where its comments mean the direction looked along); none is read back from the code.
//
// The box is 8 wide, so 800 cm, and square. Looked straight down (cosine 1), at a picture 1000 rows
// high the pixel is ⌊800 / 1000⌋ = 0 cm, whose logarithm is −∞: the far plane stays at the half
// float's largest, 65504 cm. The near plane is 800 · max(1 − 1 / 0.707107, −0.5) = −331.3705 cm, less
// the arm. At 100 rows the pixel is 8 cm, log2 8 = 3, and the far plane 3 · 65504 = 196512 cm.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { orthographicProjection } from '../../../math/src/projection/camera.ts'
import { createEngineCamera } from './engineCamera.ts'
import { readCameraWorld, type ViewCamera } from './world.ts'

const BOX = { left: -4, right: 4, top: 4, bottom: -4 }
/** 800 · (1 − 1 / 0.707107), in metres: the near plane of a view looking straight down. */
const DOWN_NEAR = -3.3137049979706035

/** An orthographic eye at `position` looking at `at`, its box declaring the planes 0.5 and 100.5. */
function eye(position: [number, number, number], at: [number, number, number]): ViewCamera {
  const camera: ViewCamera = Object.assign(G.orthographicCamera(-4, 4, 4, -4, 0.5, 100.5), {
    orthographic: BOX,
  })
  camera.position.set(...position)
  camera.lookAt(...at)
  return camera
}
const down = () => eye([0, 50, 0], [0, 0, 0])

const close = (actual: ArrayLike<number>, expected: number[]) =>
  expected.forEach((value, k) =>
    assert.ok(Math.abs(actual[k] - value) < 1e-9, `${k}: ${actual[k]} ≠ ${value}`),
  )
const read = (camera: ViewCamera, context = {}, viewport: [number, number] = [1000, 1000]) =>
  readCameraWorld(createEngineCamera(), camera, 1, context, viewport)

test('without the settings of a context the origin and the range are as the camera declares', () => {
  const cam = readCameraWorld(createEngineCamera(), down(), 1)
  close(cam.eye, [0, 50, 0])
  assert.deepEqual([cam.near, cam.far], [0.5, 100.5])
})

test('looked straight down: the planes worked out, then the origin moved by the near plane and the height', () => {
  const cam = read(down())
  // Far plane 65504 cm; the origin goes forward by |min(50, 4)| · 1 + (−3.3137) = 0.6863 m.
  close(cam.eye, [0, 49.313704997970596, 0])
  close(cam.viewTarget, [0, 0, 0])
  close([cam.near, cam.far], [0, 658.3537049979707])
  const expected = new Float64Array(16)
  orthographicProjection(expected, -4, 4, -4, 4, 0, 658.3537049979707)
  close(cam.projection, [...expected])
})

test('the far plane follows the size of a pixel: 8 cm at 100 rows, its logarithm 3 times the half float', () => {
  const cam = read(down(), {}, [100, 100])
  close(cam.eye, [0, 49.313704997970596, 0])
  close([cam.near, cam.far], [0, 1968.4337049979704])
  // Without the logarithm the pixel itself: 8 · 65504 cm, held to the world's reach of 2097152 cm.
  const pixel = read(down(), { cutViewOrthoAutoPlanesScaleUnits: false }, [100, 100])
  close([pixel.far], [5243.63370499797])
})

test('a view that frames a point puts its origin on it, the arm lengthening the near plane', () => {
  const camera = down()
  camera.setViewTarget([0, 0, 0])
  const cam = read(camera)
  // Arm 5000 cm: near −331.3705 − 5000 = −5331.3705 cm. The origin: (0, 50, 0) + (0, −50, 0) + forward · near.
  close(cam.eye, [0, 53.313704997970596, 0])
  close(cam.viewTarget, [0, -53.313704997970596, 0])
  close([cam.near, cam.far], [0, 708.3537049979707])
})

test('at 45 degrees the near plane stops at half the larger side; the point is an arm of cosine · distance', () => {
  const tilted = eye([0, 10, 10], [0, 0, 0])
  // Near −400 cm, far 65504 cm; height |min(10, 4)| · 0.7071 = 2.8284 m, so forward · (2.8284 − 4).
  const cam = read(tilted)
  close(cam.eye, [0, 10.82842712474619, 10.82842712474619])
  close([cam.near, cam.far], [0, 659.04])
  tilted.setViewTarget([0, 0, 0])
  // Arm 1414.2136 · 0.7071 = 1000 cm: near −1400 cm.
  const framed = read(tilted)
  close(framed.eye, [0, 9.899494936611665, 9.899494936611665])
  close(framed.viewTarget, [0, -9.899494936611665, -9.899494936611665])
  close([framed.near, framed.far], [0, 669.04])
})

test('a level view without the half-float scale: the far plane is the height over a cosine read as 0.00001, held to the world', () => {
  const level = eye([0, 2, 10], [0, 2, 0])
  const cam = read(level, { cutViewOrthoAutoPlanesHalfFloat: false })
  // Near 800 · max(0.707107 − 1, −0.5) = −234.3144 cm; far min(8e7, 2097152 − 234.3144) cm; no height.
  close(cam.eye, [0, 2, 12.343144])
  close([cam.near, cam.far], [0, 20971.52])
})

test('the depth scale replaces the half float, the shift moves both planes, in metres', () => {
  const settings = { cutViewOrthoAutoPlanesDepthScale: 100, cutViewOrthoAutoPlanesShift: 1 }
  const cam = read(down(), settings, [100, 100])
  // Depth 10000 cm · 3 = 30000 cm, both planes + 100 cm: (−231.3705, 30100) cm; the origin goes
  // forward by 4 + (−2.3137) m.
  close(cam.eye, [0, 48.313704997970596, 0])
  close([cam.near, cam.far], [0, 303.3137049979706])
})

test('a view with no picture size works its far plane from its angle alone', () => {
  const cam = readCameraWorld(createEngineCamera(), down(), 1, {})
  close([cam.near, cam.far], [0, 11.313704997970603])
})

test('without the automatic planes the camera’s own stand, and the point it frames is not carried', () => {
  const camera = down()
  camera.setViewTarget([0, 0, 0])
  const cam = read(camera, { cutViewOrthoAutoPlanes: false })
  // No point: the origin goes forward by |min(50, 4)| + 0.5; the range [0.5, 100.5] starts at 0.
  close(cam.eye, [0, 45.5, 0])
  close(cam.viewTarget, [0, 0, 0])
  close([cam.near, cam.far], [0, 100])
})

test('without the correction the planes are worked out and the origin stays', () => {
  const camera = down()
  camera.setViewTarget([0, 0, 0])
  const cam = read(camera, { cutViewOrthoNearPlaneCorrection: false })
  close(cam.eye, [0, 50, 0])
  close(cam.viewTarget, [0, -50, 0])
  close([cam.near, cam.far], [-53.313704997970596, 655.04])
})

test('without the height as a target the origin moves by the near plane alone; the range starts where the setting says', () => {
  const cam = read(down(), {
    cutViewOrthoAutoPlanes: false,
    cutViewOrthoCameraHeightAsViewTarget: false,
    cutViewOrthoNearPlane: 2,
  })
  close(cam.eye, [0, 49.5, 0])
  close([cam.near, cam.far], [2, 102])
})

test('a perspective view is never moved', () => {
  const camera = G.perspectiveCamera(50, 1, 0.5, 100)
  camera.position.set(0, 10, 10)
  camera.lookAt(0, 0, 0)
  const cam = read(camera)
  close(cam.eye, [0, 10, 10])
  assert.deepEqual([cam.near, cam.far], [0.5, 100])
  close(cam.viewTarget, [0, 0, 0])
})
