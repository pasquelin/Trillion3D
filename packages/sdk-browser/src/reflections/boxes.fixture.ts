// Synthetic views for the reflection's tests: opaque boxes, the exact ray cast of them, a reversed
// infinite perspective camera, and the boxes rasterized into a reversed depth.
import { dotVector3 } from '../../../math/src/vector/vector.ts'
import { cross, subtract } from '../../../math/src/vector/vectorTuple.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'

export type V3 = [number, number, number]
export type Box = { low: V3; high: V3 }

const norm = (a: V3): V3 => {
  const l = Math.hypot(...a)
  return [a[0] / l, a[1] / l, a[2] / l]
}
/** Where the ray `o + d·t`, t > `from`, enters `box`, `from` when it starts inside, or Infinity. */
function rayBox(o: V3, d: V3, box: Box, from = 0) {
  let near = -Infinity,
    far = Infinity
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < box.low[k] || o[k] > box.high[k]) return Infinity
      continue
    }
    const a = (box.low[k] - o[k]) / d[k],
      b = (box.high[k] - o[k]) / d[k]
    near = Math.max(near, Math.min(a, b))
    far = Math.min(far, Math.max(a, b))
  }
  if (near > far || far <= from) return Infinity
  return Math.max(near, from)
}

/** The first of `boxes` the ray meets, and which. */
export function castBoxes(o: V3, d: V3, boxes: Box[], from = 0) {
  let t = Infinity,
    index = -1
  boxes.forEach((box, k) => {
    const at = rayBox(o, d, box, from)
    if (at < t) {
      t = at
      index = k
    }
  })
  return { t, index }
}

/**
 * A reversed infinite perspective of vertical field `fov` from `eye` toward `target`, `width ×
 * height` pixels, near plane `near`: its column-major view-projection and inverse, the world size
 * of a pixel at a unit clip `w`, a point's projection (pixel x, y, depth, clip w) and the eye's
 * ray through a pixel point.
 */
export function camera(
  eye: V3,
  target: V3,
  width: number,
  height: number,
  fov = Math.PI / 3,
  near = 0.1,
) {
  const f = norm(subtract(target, eye)),
    r = norm(cross(f, [0, 1, 0])),
    u = cross(r, f)
  const F = 1 / Math.tan(fov / 2),
    a = width / height
  const rows = [
    [...r.map((x) => (F / a) * x), (-F / a) * dotVector3(r, eye)],
    [...u.map((x) => F * x), -F * dotVector3(u, eye)],
    [0, 0, 0, near],
    [...f, -dotVector3(f, eye)],
  ]
  const m = new Float64Array(16)
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) m[col * 4 + row] = rows[row][col]
  const project = (p: V3) => {
    const c = [0, 1, 2, 3].map(
      (row) => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row],
    )
    return [
      ((c[0] / c[3]) * 0.5 + 0.5) * width,
      (-(c[1] / c[3]) * 0.5 + 0.5) * height,
      c[2] / c[3],
      c[3],
    ]
  }
  const ray = (x: number, y: number): V3 => {
    const nx = (x / width) * 2 - 1,
      ny = 1 - (y / height) * 2
    return norm([0, 1, 2].map((k) => f[k] + (nx * a * r[k] + ny * u[k]) / F) as V3)
  }
  return {
    eye,
    forward: f,
    m,
    inverse: invertMatrix4(new Float64Array(16), m),
    project,
    ray,
    width,
    height,
    near,
    scale: 2 / (height * F),
  }
}
export type Camera = ReturnType<typeof camera>

/** The face of `box` the point `p` on it lies on: 2 · axis, + 1 on its high side. */
function faceOf(box: Box, p: V3) {
  let face = 0,
    best = Infinity
  for (let k = 0; k < 3; k++)
    for (const [side, bound] of [box.low[k], box.high[k]].entries()) {
      const off = Math.abs(p[k] - bound)
      if (off < best) {
        best = off
        face = 2 * k + side
      }
    }
  return face
}

/** The reversed depth of `boxes` at each pixel centre, near / w, 0 on the background, and which
 *  plane each pixel shows: a box's face, 6 · box + face (-1 none). */
export function rasterize(view: Camera, boxes: Box[]) {
  const depth = new Float64Array(view.width * view.height)
  const shown = new Int32Array(view.width * view.height)
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      const d = view.ray(x + 0.5, y + 0.5),
        { t, index } = castBoxes(view.eye, d, boxes)
      depth[y * view.width + x] = Number.isFinite(t)
        ? view.near / (t * dotVector3(d, view.forward))
        : 0
      shown[y * view.width + x] =
        index < 0
          ? -1
          : 6 * index + faceOf(boxes[index], [0, 1, 2].map((k) => view.eye[k] + d[k] * t) as V3)
    }
  return { depth, shown }
}
