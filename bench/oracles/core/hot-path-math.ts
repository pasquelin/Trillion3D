// The hot-path math of packages/math frozen: the seeded inputs its tests feed it
// (`bench/witnesses/three/parity/core/math/primitives/coneDefinition.test.ts`,
// `bench/witnesses/three/parity/core/math/frustum/box.test.ts`), and the frustum's former indexed
// bounds its optimised form must match bit for bit.
import { xorshiftRandom } from '../../../packages/math/src/sequence/random.ts'
import { HOSTILE_FLOATS } from '../../../tests/kit/assert/hostile.ts'

/** Seeded floats: one in eight hostile or maximal, the others of every sign and scale. */
export function hostileFloats(seed: number) {
  const next = xorshiftRandom(seed)
  const rare = [...HOSTILE_FLOATS, Number.MAX_VALUE, -Number.MAX_VALUE]
  return (scale = 10) =>
    next() < 0.125
      ? rare[Math.floor(next() * rare.length)]
      : (next() - 0.5) * scale * 10 ** Math.floor(next() * 3 - 1)
}

/**
 * Seeded cone cases, one in two hostile throughout; the other grazing: an identity placement and
 * an axis nearly across the view, `toward` a hair on either side of 0, under a cone angle down
 * to 1e-9, where the early exit and the full verdict are closest.
 */
export function coneCases(seed: number) {
  const f = hostileFloats(seed)
  const next = xorshiftRandom(seed + 1)
  const at = (n: number, scale?: number) => Array.from({ length: n }, () => f(scale))
  return (i: number) => {
    if (i % 2 === 0) {
      const [min, extent] = [at(3), at(3)]
      return {
        axis: at(3),
        angle: Math.abs(f(1)),
        min,
        max: min.map((v, k) => v + Math.abs(extent[k])),
        world: [...at(3), 0, ...at(3), 0, ...at(3), 0, ...at(4, 100)],
        normal: at(9),
        scale: Math.abs(f(2)),
        eye: [...at(3, 1000), i % 4 ? 1 : 0],
      }
    }
    const t = at(3, 100).map((v) => (Number.isFinite(v) && Math.abs(v) < 1e300 ? v : 1))
    const eye = [(next() - 0.5) * 1000, (next() - 0.5) * 1000, (next() - 0.5) * 1000, 1]
    const [vx, vy, vz] = [eye[0] - t[0], eye[1] - t[1], eye[2] - t[2]]
    const [rx, ry, rz] = [next() - 0.5, next() - 0.5, next() - 0.5]
    const lean = (next() - 0.5) * 10 ** -Math.floor(next() * 10) * Math.hypot(rx, ry, rz)
    return {
      axis: [
        vy * rz - vz * ry - lean * vx,
        vz * rx - vx * rz - lean * vy,
        vx * ry - vy * rx - lean * vz,
      ],
      angle: 10 ** -Math.floor(next() * 10),
      min: [-1e-6, -1e-6, -1e-6],
      max: [1e-6, 1e-6, 1e-6],
      world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1],
      normal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      scale: 1,
      eye,
    }
  }
}

/** `frustumClipBox` unoptimised: the bounds stored in an array the plane's sign indexes. */
export function frustumClipBoxBefore(planes: ArrayLike<number>, box: ArrayLike<number>) {
  const bounds = [box[0], box[3], box[1], box[4], box[2], box[5]]
  const side = (p: number, forward: number) => {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2]
    const f = (s: number) => (s > 0 ? forward : 1 - forward)
    return a * bounds[f(a)] + b * bounds[2 + f(b)] + c * bounds[4 + f(c)] + planes[p + 3] < 0
  }
  for (let p = 0; p < 24; p += 4) if (side(p, 1)) return 0
  for (let p = 0; p < 24; p += 4) if (side(p, 0)) return 1
  return 2
}
