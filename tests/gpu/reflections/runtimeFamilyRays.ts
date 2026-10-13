// The exact geometry of the family (`runtimeFamilyCases.ts`): the crossings of a ray with each shape, closed
// form where one exists (sphere, ellipsoid, box, post, quad, disc) and the root of the torus's quartic
// bracketed and bisected to 1e-9, in the shape's own frame; and the radiance a ray brings back through up
// to three layers, as the proxy's contract says (a blended surface weighs its own radiance by its opacity and
// lets the rest through, an opaque one ends the ray). Nothing here reads the engine.
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import type { FamilyCase, Rgb, Shape } from './runtimeFamilyCases.ts'

export type Vec = [number, number, number]
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const length = (a: Vec) => length3(a[0], a[1], a[2])
export const unit = (a: Vec): Vec => scale(a, 1 / length(a))

/** A world vector in a shape's frame: the inverse of its pose, `pitch` about x then `yaw` about y. */
function unturn(v: Vec, yaw: number, pitch: number): Vec {
  const [cp, sp, cy, sy] = [Math.cos(pitch), Math.sin(pitch), Math.cos(yaw), Math.sin(yaw)]
  const x = v[0] * cy - v[2] * sy,
    y0 = v[1],
    z0 = v[0] * sy + v[2] * cy
  return [x, y0 * cp + z0 * sp, -y0 * sp + z0 * cp]
}

/** Where shape `s` stands once its move is made: its centre plus the move. */
const finalCentre = (s: Shape): Vec => (s.kind === 'skinned' ? s.centre : add(s.centre, s.move))

/** The parameters `t > 1e-6` at which the ray `o + t d` crosses shape `s`, ascending. */
export function crossings(s: Shape, o: Vec, d: Vec): number[] {
  const lo = unturn(sub(o, finalCentre(s)), s.yaw, s.pitch),
    ld = unturn(d, s.yaw, s.pitch)
  if (s.kind === 'skinned') {
    // The upper bone's move weighs linearly in height, from 0 at the foot to 1 at the top: the bent post is
    // the straight one sheared, and a ray in the sheared frame is a ray again.
    const k = 1 / (2 * s.size[1])
    for (const at of [0, 2]) {
      lo[at] -= s.move[at] * (lo[1] + s.size[1]) * k
      ld[at] -= s.move[at] * ld[1] * k
    }
  }
  const hits: number[] = []
  const [a, b] = s.size
  const quadratic = (qa: number, qb: number, qc: number) => {
    const disc = qb * qb - 4 * qa * qc
    if (qa === 0 || disc < 0) return []
    const root = Math.sqrt(disc)
    return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]
  }
  if (s.kind === 'sphere' || s.kind === 'morph') {
    // An ellipsoid: the axes a, a(1 + 0.6 w), a; a sphere at weight zero.
    const k: Vec = [1 / a, 1 / (a * (1 + 0.6 * s.weight)), 1 / a]
    const p: Vec = [lo[0] * k[0], lo[1] * k[1], lo[2] * k[2]],
      q: Vec = [ld[0] * k[0], ld[1] * k[1], ld[2] * k[2]]
    hits.push(...quadratic(dot(q, q), 2 * dot(p, q), dot(p, p) - 1))
  } else if (s.kind === 'box') {
    let near = -Infinity,
      far = Infinity
    for (let k = 0; k < 3; k++) {
      const half = s.size[k]
      if (Math.abs(ld[k]) < 1e-12) {
        if (Math.abs(lo[k]) > half) return []
        continue
      }
      const [t0, t1] = [(-half - lo[k]) / ld[k], (half - lo[k]) / ld[k]]
      const [in0, out0] = t0 < t1 ? [t0, t1] : [t1, t0]
      if (in0 > near) near = in0
      if (out0 < far) far = out0
    }
    if (near <= far) hits.push(near, far)
  } else if (s.kind === 'post' || s.kind === 'skinned') {
    // A cylinder along y, capped: sides, then the two caps.
    for (const t of quadratic(
      ld[0] ** 2 + ld[2] ** 2,
      2 * (lo[0] * ld[0] + lo[2] * ld[2]),
      lo[0] ** 2 + lo[2] ** 2 - a * a,
    )) {
      if (Math.abs(lo[1] + t * ld[1]) <= b) hits.push(t)
    }
    for (const cap of [-b, b]) {
      const t = (cap - lo[1]) / ld[1]
      if (Math.abs(ld[1]) > 1e-12 && (lo[0] + t * ld[0]) ** 2 + (lo[2] + t * ld[2]) ** 2 <= a * a)
        hits.push(t)
    }
  } else if (s.kind === 'quad' || s.kind === 'disc') {
    const t = -lo[1] / ld[1]
    const [x, z] = [lo[0] + t * ld[0], lo[2] + t * ld[2]]
    const inside = s.kind === 'quad' ? Math.abs(x) <= a && Math.abs(z) <= b : x * x + z * z <= a * a
    if (Math.abs(ld[1]) > 1e-12 && inside) hits.push(t)
  } else {
    // The torus about y: its implicit function along the ray, sampled across the bounding sphere and
    // bisected where it changes sign.
    const reach = a + b,
      f = (t: number) => {
        const x = lo[0] + t * ld[0],
          y = lo[1] + t * ld[1],
          z = lo[2] + t * ld[2]
        const g = x * x + y * y + z * z + a * a - b * b
        return g * g - 4 * a * a * (x * x + z * z)
      }
    const mid = -dot(lo, ld),
      span = Math.sqrt(Math.max(0, reach * reach - (dot(lo, lo) - mid * mid)))
    if (span > 0) {
      const steps = 256
      let previous = f(mid - span)
      for (let i = 1; i <= steps; i++) {
        const t1 = mid - span + (2 * span * i) / steps,
          value = f(t1)
        if (previous * value < 0) {
          let [x0, x1, f0] = [t1 - (2 * span) / steps, t1, previous]
          for (let k = 0; k < 60; k++) {
            const m = (x0 + x1) / 2,
              fm = f(m)
            if (f0 * fm <= 0) x1 = m
            else [x0, f0] = [m, fm]
          }
          hits.push((x0 + x1) / 2)
        }
        previous = value
      }
    }
  }
  return hits.filter((t) => t > 1e-6).sort((x, y) => x - y)
}

/** Layers a ray holds at most (`RAY_LAYERS`): the proxy's own contract. */
const LAYERS = 3

/** What the ray brings back: the emission of what it meets, a blended surface weighing its own and letting
 *  the rest through, an opaque one (emitting or dark) ending it; the third layer is the last. The
 *  environment is black. `first` names the first thing met, or -1. */
export function radiance(c: FamilyCase, o: Vec, d: Vec): { rgb: Rgb; first: number } {
  const hits: { t: number; at: number }[] = []
  c.shapes.forEach((s, at) => {
    const t = crossings(s, o, d)
    // A closed blended solid is met at its front and its back; an opaque or open one at its first face.
    const both = s.opacity < 1 && s.kind !== 'quad' && s.kind !== 'disc'
    for (const x of both ? t : t.slice(0, 1)) hits.push({ t: x, at })
  })
  hits.sort((x, y) => x.t - y.t)
  const rgb: Rgb = [0, 0, 0]
  let through = 1
  for (const { at } of hits.slice(0, LAYERS)) {
    const s = c.shapes[at],
      weight = through * s.opacity
    for (let k = 0; k < 3; k++) rgb[k] += weight * s.emission[k]
    through *= 1 - s.opacity
    if (s.opacity === 1) break
  }
  return { rgb, first: hits.length ? hits[0].at : -1 }
}
