import {
  arithmeticType,
  graphError,
  isNumeric,
  widthOf,
  assertNumeric,
} from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { clamp as clampTo } from '../../../../math/src/scalar/reals.ts'
import type { Emitter } from './emitter.ts'
import { POSITIVE_POW_FLOOR, positivePow, each, lerpOf, zip } from './fold.ts'
import { coerce, constantOf, isConstantOf, sameValue, splat, widen, type Value } from './value.ts'

/** The operators of the four rules of arithmetic. */
export type Operator = '+' | '-' | '*' | '/'
const COMBINE: Record<Operator, (x: number, y: number) => number> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => x / y,
}

const finite = (numbers: readonly number[]) => numbers.every(Number.isFinite)
const zeroOf = (type: Value['type']) => constantOf(type, Array<number>(widthOf(type)).fill(0))

/** The result of a multiplication or a division that needs no code: by zero, by one. */
function trivial(op: Operator, a: Value, b: Value, type: Value['type']): Value | undefined {
  const width = widthOf(type)
  if (op === '*') {
    if (isConstantOf(a, 0) || isConstantOf(b, 0)) return zeroOf(type)
    if (isConstantOf(a, 1)) return { ...splat(b, width), type }
    if (isConstantOf(b, 1)) return { ...splat(a, width), type }
  }
  if (op === '/') {
    if (isConstantOf(a, 0)) return zeroOf(type)
    if (isConstantOf(b, 1)) return { ...splat(a, width), type }
  }
  return undefined
}

/** `a` over `b`, where `b` is the same at every pixel: over `b` where `a` is too, else by the
 *  reciprocal of `b`, which the pixels share. */
function overFixed(e: Emitter, a: Value, b: Value, type: Value['type']): Value {
  const width = widthOf(type)
  const left = splat(a, width)
  if (e.uniform(a)) return e.local(type, `(${left.code} / ${splat(b, width).code})`)
  const reciprocal = e.local(b.type, `(1.0/${b.code})`)
  return e.local(type, `(${left.code} * ${splat(reciprocal, width).code})`)
}

/** `a` and `b` by `op` of two constants whose result does not fold to a finite number
 *  (a zero divisor, an overflow): the shader's own, infinite or not a number, as a plain operation is
 *  at run time. Written beside constants the shader's compiler refuses the operation (WGSL
 *  const-evaluation errors on a division by zero or an overflow), so the second operand is held in a local,
 *  which is no constant expression. */
function unfolded(e: Emitter, op: Operator | '%', a: Value, b: Value, type: Value['type']): Value {
  const width = widthOf(type)
  const divisor = e.local(type, splat(b, width).code)
  return e.local(type, `(${splat(a, width).code} ${op} ${divisor.code})`)
}

/** `a` and `b` combined by `op`: a scalar is repeated to the other's width, two vectors of different
 *  widths are refused. A product by zero or one, a quotient of zero or by one, and any operation
 *  between constants are not written as code. A division is a plain division, by zero included; by a
 *  divisor the pixels share (a parameter) under a dividend that varies, a product by its reciprocal. */
export function arithmetic(e: Emitter, op: Operator, a: Value, b: Value): Value {
  const type = arithmeticType(a.type, b.type)
  const short = trivial(op, a, b, type)
  if (short) return short
  if (a.constant && b.constant) {
    const folded = zip(a.constant, b.constant, COMBINE[op])
    if (finite(folded)) return constantOf(type, folded)
    return unfolded(e, op, a, b, type)
  }
  if (op === '/' && e.uniform(b) && !b.constant) return overFixed(e, a, b, type)
  const width = widthOf(type)
  return e.local(type, `(${splat(a, width).code} ${op} ${splat(b, width).code})`)
}

/** The remainder of `a` over `b`, of the sign of `a`, a scalar repeated to the other's width. A
 *  remainder of constants folds; by zero it is the shader's (`unfolded`). */
export function remainder(e: Emitter, a: Value, b: Value): Value {
  const type = arithmeticType(a.type, b.type)
  const width = widthOf(type)
  if (a.constant && b.constant) {
    const folded = zip(a.constant, b.constant, (x, y) => x % y)
    return finite(folded) ? constantOf(type, folded) : unfolded(e, '%', a, b, type)
  }
  return e.local(type, `(${splat(a, width).code} % ${splat(b, width).code})`)
}

/** The angle from the x axis to the point (`x`, `y`), from -π to π. Of two values the pixels share
 *  only the first components are read, and the angle is a scalar; otherwise a scalar is repeated to the
 *  other's width. */
export function arctangent2(e: Emitter, y: Value, x: Value): Value {
  const type = arithmeticType(y.type, x.type)
  const fixed = e.uniform(y) && e.uniform(x)
  const [top, right] = fixed ? [coerce(y, 'flex'), coerce(x, 'flex')] : [y, x]
  if (top.constant && right.constant)
    return constantOf('flex', zip(top.constant, right.constant, Math.atan2))
  const width = fixed ? 1 : widthOf(type)
  return e.local(
    fixed ? 'flex' : type,
    `atan2(${splat(top, width).code},${splat(right, width).code})`,
  )
}

/** The smaller or the larger of `a` and `b`, which is made the type of `a`. */
export function extreme(e: Emitter, pick: 'min' | 'max', a: Value, b: Value): Value {
  assertNumeric(a.type, pick)
  const other = coerce(b, a.type)
  if (a.constant && other.constant)
    return constantOf(a.type, zip(a.constant, other.constant, Math[pick]))
  return e.local(a.type, `${pick}(${a.code},${other.code})`)
}

/** `x` held to at least 0 and at most 1. */
export function saturate(e: Emitter, x: Value): Value {
  if (x.constant)
    return constantOf(
      x.type,
      each(x.constant, (v) => clampTo(v, 0, 1)),
    )
  return e.local(x.type, `saturate(${x.code})`)
}

/** `x` held between `low` and `high`, both made the type of `x`. */
export function clamp(e: Emitter, x: Value, low: Value, high: Value): Value {
  const a = coerce(low, x.type)
  const b = coerce(high, x.type)
  if ((a.constant || b.constant) && x.constant) return extreme(e, 'min', extreme(e, 'max', x, a), b)
  if (isConstantOf(a, 0) && isConstantOf(b, 1)) return saturate(e, x)
  return e.local(x.type, `min(max(${x.code},${a.code}),${b.code})`)
}

/** `x` to `y` by `alpha`: `x` or `y` where the alpha is the constant 0 or 1, either where they are
 *  the same value, a constant where all three are constants. */
export function lerp(e: Emitter, x: Value, y: Value, alpha: Value): Value {
  const type = arithmeticType(x.type, y.type)
  const width = widthOf(type)
  if (!isNumeric(alpha.type)) throw graphError('Lerp alpha argument is not a number')
  const ca = splat(x, width)
  const cb = splat(y, width)
  if (sameValue(x, y) || (x.constant && y.constant && sameValue(ca, cb))) return { ...ca, type }
  if (isConstantOf(alpha, 0)) return { ...ca, type }
  if (isConstantOf(alpha, 1)) return { ...cb, type }
  if (widthOf(alpha.type) !== 1 && widthOf(alpha.type) !== width)
    throw graphError(`Lerp alpha has ${widthOf(alpha.type)} components against ${width}`)
  if (ca.constant && cb.constant && alpha.constant)
    return constantOf(type, lerpOf(ca.constant, cb.constant, alpha.constant))
  return e.local(type, `mix(${ca.code},${cb.code},${alpha.code})`)
}

/**
 * `base` to the power `exponent`, a base at or below `POSITIVE_POW_FLOOR` giving zero, of the base's
 * type. The exponent is read as the base is: a scalar is repeated, a vector of the base's width
 * works on each component of it, a vector over a scalar base gives its first component; two vectors
 * of different widths are refused. An exponent of 1 or 0, or a base of 0, is not written as code.
 */
export function power(e: Emitter, base: Value, exponent: Value): Value {
  const type = base.type
  const width = widthOf(type)
  arithmeticType(type, exponent.type)
  if (exponent.constant) {
    const hit = isConstantOf(exponent, 1)
      ? base
      : isConstantOf(exponent, 0)
        ? constantOf('flex', [1])
        : isConstantOf(base, 0)
          ? constantOf('flex', [0])
          : undefined
    if (hit) return { ...splat(hit, width), type }
  }
  const ex = coerce(exponent, width === 1 ? 'flex' : type)
  if (base.constant && ex.constant)
    return constantOf(type, zip(base.constant, ex.constant, positivePow))
  const floor = constantOf(type, widen([POSITIVE_POW_FLOOR], width)).code
  const none = splat(constantOf('flex', [0]), width).code
  return e.local(type, `select(pow(${base.code},${ex.code}),${none},${base.code}<=${floor})`)
}
