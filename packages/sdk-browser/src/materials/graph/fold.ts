import { widen } from './value.ts'

/** A component of a constant, held to the single precision the shader computes in. */
const single = Math.fround

/** The components of `a` and `b` combined one to one, a scalar repeated to the wider. */
export function zip(
  a: readonly number[],
  b: readonly number[],
  combine: (x: number, y: number) => number,
) {
  const width = Math.max(a.length, b.length)
  const right = widen(b, width)
  return widen(a, width).map((x, i) => single(combine(x, right[i])))
}

/** The components of `a` each changed by `change`. */
export const each = (a: readonly number[], change: (x: number) => number) =>
  a.map((x) => single(change(x)))

/** The dot product of two constants of the same width. */
export const dotOf = (a: readonly number[], b: readonly number[]) =>
  single(a.reduce((sum, x, i) => sum + x * b[i], 0))

/** The length of a constant. */
export const lengthOf = (a: readonly number[]) => single(Math.sqrt(dotOf(a, a)))

/** The cross product of two constants of three components. */
export const crossOf = (a: readonly number[], b: readonly number[]) => [
  single(a[1] * b[2] - a[2] * b[1]),
  single(a[2] * b[0] - a[0] * b[2]),
  single(a[0] * b[1] - a[1] * b[0]),
]

/** `base` to the power `exponent`, a negative base counting as zero. */
export const positivePow = (base: number, exponent: number) => Math.pow(Math.max(base, 0), exponent)

/** `a` to `b` by `t`, componentwise, a scalar repeated to the widest. */
export function lerpOf(a: readonly number[], b: readonly number[], t: readonly number[]) {
  const width = Math.max(a.length, b.length, t.length)
  const [x, y, s] = [a, b, t].map((c) => widen(c, width))
  return x.map((v, i) => single(v + (y[i] - v) * s[i]))
}
