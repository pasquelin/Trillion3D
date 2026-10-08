// The matrix functions before their rewrites, word for word but their names (a call to a rewritten
// one names its before-form): the oracles `matrix4Moves.test.ts` and `matrix4TypedMoves.test.ts`
// hold the shipped ones to.
import { multiplyMatrix4, type NumberSink } from './matrix4.ts'

export function multiplyMatrix4Before(out: Float64Array, a: Float64Array, b: Float64Array) {
  const a11 = a[0],
    a12 = a[4],
    a13 = a[8],
    a14 = a[12]
  const a21 = a[1],
    a22 = a[5],
    a23 = a[9],
    a24 = a[13]
  const a31 = a[2],
    a32 = a[6],
    a33 = a[10],
    a34 = a[14]
  const a41 = a[3],
    a42 = a[7],
    a43 = a[11],
    a44 = a[15]
  const b11 = b[0],
    b12 = b[4],
    b13 = b[8],
    b14 = b[12]
  const b21 = b[1],
    b22 = b[5],
    b23 = b[9],
    b24 = b[13]
  const b31 = b[2],
    b32 = b[6],
    b33 = b[10],
    b34 = b[14]
  const b41 = b[3],
    b42 = b[7],
    b43 = b[11],
    b44 = b[15]
  out[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41
  out[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42
  out[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43
  out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44
  out[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41
  out[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42
  out[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43
  out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44
  out[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41
  out[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42
  out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43
  out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44
  out[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41
  out[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42
  out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43
  out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44
  return out
}

export function linearPartDeterminantBefore(m: ArrayLike<number>) {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  )
}

export function copyMatrix4Before<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  outAt = 0,
  mAt = 0,
) {
  for (let i = 0; i < 16; i++) out[outAt + i] = m[mAt + i]
  return out
}

export function negateColumnMatrix4Before<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  c: number,
) {
  copyMatrix4Before(out, m)
  for (let r = 0; r < 4; r++) out[4 * c + r] = -m[4 * c + r]
  return out
}

export function negateRowMatrix4Before<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  r: number,
) {
  copyMatrix4Before(out, m)
  for (let c = 0; c < 4; c++) out[4 * c + r] = -m[4 * c + r]
  return out
}

export function transposeMatrix4Before<T extends NumberSink>(out: T, m: ArrayLike<number>) {
  for (let r = 0; r < 4; r++) {
    out[r * 5] = m[r * 5]
    for (let c = r + 1; c < 4; c++) {
      const upper = m[c * 4 + r],
        lower = m[r * 4 + c]
      out[c * 4 + r] = lower
      out[r * 4 + c] = upper
    }
  }
  return out
}

export function linearPartIdentityDistanceSqBefore(m: ArrayLike<number>, at = 0) {
  let sum = 0
  for (let column = 0; column < 3; column++) {
    const x = m[at + column * 4],
      y = m[at + column * 4 + 1],
      z = m[at + column * 4 + 2]
    sum += (x - +(column === 0)) ** 2 + (y - +(column === 1)) ** 2 + (z - +(column === 2)) ** 2
  }
  return sum
}

const leftOperand = new Float64Array(16),
  rightOperand = new Float64Array(16),
  product = new Float64Array(16)

export function multiplyMatrix4TypedBefore<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
) {
  multiplyMatrix4(product, copyMatrix4Before(leftOperand, a), copyMatrix4Before(rightOperand, b))
  return copyMatrix4Before(out, product)
}
