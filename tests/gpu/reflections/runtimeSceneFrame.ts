// The generated scene of the run-time proxy's proof, and the image it must give: an emissive sphere
// with a point light at its centre, on a thin post over a polished metal floor, seen from above. Every
// floor pixel whose mirror ray meets the sphere shows its emission; the mirror ray meets the sphere's
// hidden side, which the image does not hold — the run-time proxy's.
import { length2, length3 } from '../../../packages/math/src/vector/vector.ts'
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'

export const SPHERE = { centre: [0, 4.3, 0], radius: 0.35 } as const
export const POST = { radius: 0.12, height: 4 } as const
export const EYE = [0, 9, 6] as const
export const TARGET = [0, 1.5, 0] as const
export const FOV = 50

type Vec = [number, number, number]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec): Vec => {
  const l = length3(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** The first distance along `d` from `o` at which the ray meets the sphere, or `Infinity`. */
function sphereHit(o: Vec, d: Vec) {
  const m = sub(o, [...SPHERE.centre]),
    b = dot(m, d),
    c = dot(m, m) - SPHERE.radius ** 2,
    disc = b * b - c
  if (disc < 0) return Infinity
  const t = -b - Math.sqrt(disc)
  return t > 1e-4 ? t : Infinity
}

/** The first distance at which the ray meets the post, a vertical cylinder on the floor, or `Infinity`. */
function postHit(o: Vec, d: Vec) {
  const a = d[0] ** 2 + d[2] ** 2,
    b = o[0] * d[0] + o[2] * d[2],
    c = o[0] ** 2 + o[2] ** 2 - POST.radius ** 2,
    disc = b * b - a * c
  if (a < 1e-12 || disc < 0) return Infinity
  const t = (-b - Math.sqrt(disc)) / a,
    y = o[1] + t * d[1]
  return t > 1e-4 && y >= 0 && y <= POST.height ? t : Infinity
}

/**
 * The pixels of a `width × height` image, row 0 on top, whose floor point mirrors the sphere: the
 * primary ray reaches the floor before the post or the sphere, and the mirror ray reaches the sphere
 * before the post, none within `margin` metres of the post. `aspect` is the picture's width over its height.
 */
export function mirroredSphere(width: number, height: number, aspect: number, margin = 0.6) {
  const eye: Vec = [...EYE],
    forward = norm(sub([...TARGET], eye)),
    right = norm(cross(forward, [0, 1, 0])),
    up = cross(right, forward),
    slope = perspectiveSlope(FOV)
  const mask: number[] = []
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const x = ((i + 0.5) / width) * 2 - 1,
        y = 1 - ((j + 0.5) / height) * 2
      const d = norm([
        forward[0] + right[0] * x * slope * aspect + up[0] * y * slope,
        forward[1] + right[1] * x * slope * aspect + up[1] * y * slope,
        forward[2] + right[2] * x * slope * aspect + up[2] * y * slope,
      ])
      if (d[1] >= 0) continue
      const floor = -eye[1] / d[1]
      if (postHit(eye, d) < floor || sphereHit(eye, d) < floor) continue
      const p: Vec = [eye[0] + d[0] * floor, 0, eye[2] + d[2] * floor]
      const r: Vec = [d[0], -d[1], d[2]]
      const toSphere = sphereHit(p, r)
      if (!Number.isFinite(toSphere) || postHit(p, r) < toSphere) continue
      if (length2(p[0], p[2]) < margin) continue
      mask.push(j * width + i)
    }
  return mask
}
