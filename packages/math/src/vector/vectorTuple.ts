import { addVector3, crossVector3, dotVector3, normalizeVector3, subVector3 } from './vector.ts'

type Vec3 = [number, number, number]

/** A difference in a fresh tuple, accepting arrays and typed-array inputs. */
export const subtract = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 =>
  subVector3<Vec3>([0, 0, 0], a, b)
/** A sum in a fresh tuple. */
export const add = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 =>
  addVector3<Vec3>([0, 0, 0], a, b)
/** `a` times `s` in a fresh tuple. */
export const scale = (a: ArrayLike<number>, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
/** The direction `d` reflected about the unit normal `n`, `d − 2(d·n)n` (WGSL's \`reflect\`), in a
 *  fresh tuple. */
export const reflect = (d: ArrayLike<number>, n: ArrayLike<number>): Vec3 => {
  const k = 2 * dotVector3(d, n)
  return [d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]]
}
/** A cross product in a fresh tuple. */
export const cross = (a: Vec3, b: Vec3): Vec3 => crossVector3<Vec3>([0, 0, 0], a, b)

/** A tuple normalized in place and returned without another allocation. */
export const unit = (v: Vec3): Vec3 => {
  normalizeVector3(v)
  return v
}
