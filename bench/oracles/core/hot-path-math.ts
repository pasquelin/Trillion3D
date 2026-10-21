// The hot-path math of packages/math frozen: the seeded inputs its tests feed it
// (`bench/witnesses/three/parity/core/math/frustum/box.test.ts`), and the frustum's former indexed
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
