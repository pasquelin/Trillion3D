import { bilinearRead } from '../../../materials/texture/bilinear.fixture.ts'

/**
 * The oracles of the bloom's blur, rebuilt from its definition rather than from the engine's
 * kernel: the weight of each texel of a Gaussian of a radius, and what a list of bilinear reads
 * weighs each texel it touches.
 */

/** The weight of each texel `−reach … +reach` of the Gaussian of `radius` texels, `exp(−16.7
 *  (x / radius)²)` normalised to 1, `reach` the radius rounded up and held to 31, the radius
 *  itself held to 31 as well. */
export function bellOf(radius: number) {
  const sigma = Math.min(radius, 31),
    reach = Math.min(Math.ceil(sigma), 31)
  const weights = new Map<number, number>()
  let sum = 0
  for (let x = -reach; x <= reach; x++) {
    const weight = Math.exp(-16.7 * (x / sigma) ** 2)
    weights.set(x, weight)
    sum += weight
  }
  for (const [x, weight] of weights) weights.set(x, weight / sum)
  return weights
}

/** What `count` reads of `offsets` and `weights` weigh each texel they touch: a read at `o` takes
 *  `1 − t` of the texel `⌊o⌋` and `t` of the next, `t` the fraction of `o`, as a bilinear sampler
 *  does. */
export function texelsOf(offsets: ArrayLike<number>, weights: ArrayLike<number>, count: number) {
  const texels = new Map<number, number>()
  const add = (x: number, weight: number) => texels.set(x, (texels.get(x) ?? 0) + weight)
  for (let i = 0; i < count; i++) {
    const at = Math.floor(offsets[i]),
      t = offsets[i] - at
    add(at, weights[i] * (1 - t))
    if (t) add(at + 1, weights[i] * t)
  }
  return texels
}

/** A grid of one channel, row by row. */
export type Image = { data: Float64Array; w: number; h: number }

/** The sampler's bilinear read of `image` at texel coordinates `(x, y)`, clamped to its edge. */
export const bilinear = ({ data, w, h }: Image, x: number, y: number) =>
  bilinearRead((i, j) => data[j * w + i], w, h, x, y)

/** An `rgba16float` target's store of `x`: the nearest half, ties to even, ±Inf from 65520 on,
 *  NaN and the zeros' sign kept (`Math.f16round`, missing from Node 22). */
export function f16(x: number) {
  const a = Math.abs(x)
  if (!Number.isFinite(x)) return x
  if (a >= 65520) return Math.sign(x) * Infinity
  let e = Math.max(-14, Math.floor(Math.log2(a || 1)))
  if (2 ** e > a && e > -14) e--
  const step = 2 ** (e - 10),
    n = a / step,
    floor = Math.floor(n)
  const up = n - floor > 0.5 || (n - floor === 0.5 && floor % 2 === 1)
  return (x < 0 || Object.is(x, -0) ? -1 : 1) * (up ? floor + 1 : floor) * step
}
