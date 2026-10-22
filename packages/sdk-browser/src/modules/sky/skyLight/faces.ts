import { FACES, cubeToScene } from './layout.ts'

/**
 * A FACE OF THE CAPTURE SEEN AS A CAMERA, for the programs that trace along the pixels of a view
 * (the clouds): the camera stands at the capture's position, looks along the face (`FACES`, turned
 * into the scene's axes by `cubeToScene`), its field of view 90 degrees, square, its projection
 * the reversed-depth one with no far plane (depth `near / distance along the look`).
 *
 * The matrices are column-major, as the programs read them: the view-projection, and its inverse,
 * which takes `(ndc.x, ndc.y, depth, 1)` to the point `eye + (near / depth) (forward + ndc.x
 * right + ndc.y up)`.
 */

/** The nearest distance the capture sees, metres: five centimetres. */
export const CAPTURE_NEAR_METRES = 0.05

/** The camera of face `face` standing at `eye` (scene metres). */
export function faceCamera(face: number, eye: readonly number[]) {
  const axes = FACES[face]
  const f = cubeToScene(axes.forward),
    r = cubeToScene(axes.right),
    u = cubeToScene(axes.up)
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const n = CAPTURE_NEAR_METRES
  // clip = (r·v, u·v, n, f·v) for v = point - eye.
  const rows = [
    [r[0], r[1], r[2], -dot(r, eye)],
    [u[0], u[1], u[2], -dot(u, eye)],
    [0, 0, 0, n],
    [f[0], f[1], f[2], -dot(f, eye)],
  ]
  const viewProj = new Float32Array(16)
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) viewProj[col * 4 + row] = rows[row][col]
  const inverseViewProj = new Float32Array([
    ...r.map((c) => c * n),
    0,
    ...u.map((c) => c * n),
    0,
    eye[0],
    eye[1],
    eye[2],
    1,
    ...f.map((c) => c * n),
    0,
  ])
  // The camera's world matrix, looking down its own -z, as the air's frame reads it.
  const world = new Float32Array([
    r[0],
    r[1],
    r[2],
    0,
    u[0],
    u[1],
    u[2],
    0,
    -f[0],
    -f[1],
    -f[2],
    0,
    eye[0],
    eye[1],
    eye[2],
    1,
  ])
  return { viewProj, inverseViewProj, world }
}
