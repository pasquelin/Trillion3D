// The vector bodies before `writeCrossVector3` and `writeNormalizedVector3` held their rules, word
// for word but their names: the oracles `vectorMoves.test.ts` holds the shipped ones to.
import type { NumberSink } from '../matrix/matrix4.ts'
import { length3 } from './vector.ts'

const TINY_SCALE = 2 ** 1000

export function crossVector3Before<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  outAt = 0,
  aAt = 0,
  bAt = 0,
) {
  const ax = a[aAt],
    ay = a[aAt + 1],
    az = a[aAt + 2]
  const bx = b[bAt],
    by = b[bAt + 1],
    bz = b[bAt + 2]
  out[outAt] = ay * bz - az * by
  out[outAt + 1] = az * bx - ax * bz
  out[outAt + 2] = ax * by - ay * bx
  return out
}

export function normalizeVector3Before(v: NumberSink, at = 0) {
  let inverse = 1 / (length3(v[at], v[at + 1], v[at + 2]) || 1)
  if (inverse === Infinity) {
    v[at] *= TINY_SCALE
    v[at + 1] *= TINY_SCALE
    v[at + 2] *= TINY_SCALE
    inverse = 1 / length3(v[at], v[at + 1], v[at + 2])
  }
  v[at] *= inverse
  v[at + 1] *= inverse
  v[at + 2] *= inverse
}

export function transformDirectionVector3Before<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outOffset = 0,
) {
  out[outOffset] = m[0] * x + m[4] * y + m[8] * z
  out[outOffset + 1] = m[1] * x + m[5] * y + m[9] * z
  out[outOffset + 2] = m[2] * x + m[6] * y + m[10] * z
  normalizeVector3Before(out, outOffset)
  return out
}
