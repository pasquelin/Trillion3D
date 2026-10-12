// A still frame of mirror spheres standing on a dark floor under a bright sky (`rig.ts`), computed
// analytically: each pixel's eye ray meets a sphere, the floor or the sky; a sphere is a polished
// metal that reflects, the floor a dark diffuse one, the sky is the background (no resident proxy:
// what the screen cannot answer is the sky's). `exactReflection`
// is the mirror ray of a sphere pixel followed exactly, the reference the engine's image is read
// against.
import { camera, type V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import type { RigFrame } from './rigFrame.ts'

export const SPHERES = {
  width: 960,
  height: 720,
  eye: [0, 0.5, 6] as V3,
  target: [0, 0.8, 0] as V3,
  fov: 50 * DEG2RAD,
  /** The spheres' centres, their common radius. */
  centres: [
    [-1.3, 1, 0],
    [1.4, 1, -1.5],
  ] as V3[],
  radius: 1,
  /** The floor's lit colour, the spheres' (their previous image's), the sky's (the background). */
  floor: 0.02,
  sphere: 0.5,
  sky: 1,
}
const STANDARD = 2,
  DIFFUSE = 4

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** What the ray `o + d·t` (t > `from`) meets first: a sphere (its index), the floor (-2) or the sky
 *  (-1), and the distance. */
function castSpheres(o: V3, d: V3, from = 0) {
  let t = Infinity,
    index = -1
  SPHERES.centres.forEach((c, k) => {
    const oc = sub(o, c),
      b = dot(oc, d),
      disc = b * b - (dot(oc, oc) - SPHERES.radius ** 2)
    if (disc < 0) return
    const root = Math.sqrt(disc)
    for (const at of [-b - root, -b + root])
      if (at > from) {
        if (at < t) ((t = at), (index = k))
        return
      }
  })
  if (d[1] < 0) {
    const at = -o[1] / d[1]
    if (at > from && at < t) ((t = at), (index = -2))
  }
  return { t, index }
}

/** The frame, the view that sees it and what each pixel shows (a sphere, -2 the floor, -1 the sky). */
export function sphereFrame() {
  const { width, height, eye, target, fov } = SPHERES
  const view = camera(eye, target, width, height, fov)
  const pixels = width * height
  const shown = new Int32Array(pixels).fill(-1)
  const frame: RigFrame = {
    size: [width, height],
    viewProjection: view.m,
    eye,
    depth: new Float32Array(pixels),
    flags: new Uint8Array(pixels),
    normals: new Float32Array(pixels * 4),
    base: new Float32Array(pixels * 4),
    radiance: new Float32Array(pixels * 4),
    background: 0xffffff,
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const d = view.ray(x + 0.5, y + 0.5),
        { t, index } = castSpheres(eye, d)
      shown[p] = index
      if (index === -1) continue
      frame.depth[p] = view.near / (t * dot(d, view.forward))
      const point = [0, 1, 2].map((k) => eye[k] + d[k] * t) as V3
      if (index >= 0) {
        const c = SPHERES.centres[index]
        const n = sub(point, c).map((v) => v / SPHERES.radius)
        frame.flags[p] = STANDARD
        frame.normals.set([...n, 0], p * 4)
        frame.base.set([1, 1, 1, 1], p * 4)
        frame.radiance.set([SPHERES.sphere, SPHERES.sphere, SPHERES.sphere, 1], p * 4)
      } else {
        frame.flags[p] = DIFFUSE
        frame.normals.set([0, 1, 0, 1], p * 4)
        frame.base.set([SPHERES.floor, SPHERES.floor, SPHERES.floor, 0], p * 4)
        frame.radiance.set([SPHERES.floor, SPHERES.floor, SPHERES.floor, 1], p * 4)
      }
    }
  return { frame, view, shown }
}

/** The mirror ray of the sphere point seen through the pixel point `(x, y)`, followed exactly: what
 *  it meets (a sphere, -2 the floor, -1 the sky) and where. `undefined` where the eye ray misses
 *  every sphere; `facing` is the cosine of the angle between the normal and the eye. */
export function exactReflection(view: ReturnType<typeof camera>, x: number, y: number) {
  const d = view.ray(x, y),
    { t, index } = castSpheres(view.eye, d)
  if (index < 0) return undefined
  const point = [0, 1, 2].map((k) => view.eye[k] + d[k] * t) as V3
  const n = sub(point, SPHERES.centres[index]).map((v) => v / SPHERES.radius) as V3
  const k = 2 * dot(d, n)
  const R = [d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]] as V3
  const hit = castSpheres(point, R, 1e-6)
  return { index: hit.index, at: point.map((c, i) => c + R[i] * hit.t) as V3, facing: -dot(d, n) }
}
