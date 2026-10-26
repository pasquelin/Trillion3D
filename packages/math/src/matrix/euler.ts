import { clamp } from '../scalar/reals.ts'
import type { NumberSink } from './matrix4.ts'

/**
 * Beyond this the middle angle is at its pole and the outer two share one degree of freedom.
 * Declared: the sine of the pitch past which the rotation matrix is treated as gimbal-locked;
 * 0.9999999 leaves about 4e-4 rad of pitch to the pole, far above float64 rounding, so a matrix
 * just under it still resolves its outer angles; a lower value locks earlier and loses their
 * precision.
 */
const POLE = 0.9999999

/**
 * The three angles, in radians, of the rotation in the upper 3×3 of the column-major `m`, applied
 * in `order` (intrinsic, the first letter outermost), written `x, y, z` into `out`. The middle
 * angle is the arcsine of its clamped term; past `POLE` the outer two are locked together, the
 * second one written 0.
 */
export function eulerFromRotationMatrix<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  order = 'XYZ',
) {
  switch (order) {
    case 'YXZ':
      eulerYxz(out, m)
      break
    case 'ZXY':
      eulerZxy(out, m)
      break
    case 'ZYX':
      eulerZyx(out, m)
      break
    case 'YZX':
      eulerYzx(out, m)
      break
    case 'XZY':
      eulerXzy(out, m)
      break
    default:
      eulerXyz(out, m)
  }
  return out
}

/** Writes the angles `x, y, z` into `out`. */
function writeAngles(out: NumberSink, x: number, y: number, z: number) {
  out[0] = x
  out[1] = y
  out[2] = z
}

function eulerYxz(out: NumberSink, m: ArrayLike<number>) {
  const m11 = m[0],
    m13 = m[8],
    m21 = m[1],
    m22 = m[5],
    m23 = m[9],
    m31 = m[2],
    m33 = m[10]
  let y: number,
    z = 0
  const x = Math.asin(-clamp(m23, -1, 1))
  if (Math.abs(m23) < POLE) {
    y = Math.atan2(m13, m33)
    z = Math.atan2(m21, m22)
  } else y = Math.atan2(-m31, m11)
  writeAngles(out, x, y, z)
}

function eulerZxy(out: NumberSink, m: ArrayLike<number>) {
  const m11 = m[0],
    m12 = m[4],
    m21 = m[1],
    m22 = m[5],
    m31 = m[2],
    m32 = m[6],
    m33 = m[10]
  let y = 0,
    z: number
  const x = Math.asin(clamp(m32, -1, 1))
  if (Math.abs(m32) < POLE) {
    y = Math.atan2(-m31, m33)
    z = Math.atan2(-m12, m22)
  } else z = Math.atan2(m21, m11)
  writeAngles(out, x, y, z)
}

function eulerZyx(out: NumberSink, m: ArrayLike<number>) {
  const m11 = m[0],
    m12 = m[4],
    m21 = m[1],
    m22 = m[5],
    m31 = m[2],
    m32 = m[6],
    m33 = m[10]
  let x = 0,
    z: number
  const y = Math.asin(-clamp(m31, -1, 1))
  if (Math.abs(m31) < POLE) {
    x = Math.atan2(m32, m33)
    z = Math.atan2(m21, m11)
  } else z = Math.atan2(-m12, m22)
  writeAngles(out, x, y, z)
}

function eulerYzx(out: NumberSink, m: ArrayLike<number>) {
  const m11 = m[0],
    m13 = m[8],
    m21 = m[1],
    m22 = m[5],
    m23 = m[9],
    m31 = m[2],
    m33 = m[10]
  let x = 0,
    y: number
  const z = Math.asin(clamp(m21, -1, 1))
  if (Math.abs(m21) < POLE) {
    x = Math.atan2(-m23, m22)
    y = Math.atan2(-m31, m11)
  } else y = Math.atan2(m13, m33)
  writeAngles(out, x, y, z)
}

/** `XZY` and `XYZ` read the same seven entries and differ in the pivot and the pole branch. */
function eulerXzyOrXyz(out: NumberSink, m: ArrayLike<number>, zFirst: boolean) {
  const m11 = m[0],
    m12 = m[4],
    m13 = m[8],
    m22 = m[5],
    m23 = m[9],
    m32 = m[6],
    m33 = m[10]
  if (zFirst) {
    let x: number,
      y = 0
    const z = Math.asin(-clamp(m12, -1, 1))
    if (Math.abs(m12) < POLE) {
      x = Math.atan2(m32, m22)
      y = Math.atan2(m13, m11)
    } else x = Math.atan2(-m23, m33)
    writeAngles(out, x, y, z)
  } else {
    let x: number,
      z = 0
    const y = Math.asin(clamp(m13, -1, 1))
    if (Math.abs(m13) < POLE) {
      x = Math.atan2(-m23, m33)
      z = Math.atan2(-m12, m11)
    } else x = Math.atan2(m32, m22)
    writeAngles(out, x, y, z)
  }
}

function eulerXzy(out: NumberSink, m: ArrayLike<number>) {
  eulerXzyOrXyz(out, m, true)
}

function eulerXyz(out: NumberSink, m: ArrayLike<number>) {
  eulerXzyOrXyz(out, m, false)
}
