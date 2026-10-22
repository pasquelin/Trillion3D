import {
  arithmeticType,
  graphError,
  isNumeric,
  widthOf,
  describeType,
} from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { clamp as clampTo } from '../../../../math/src/scalar/reals.ts'
import type { Emitter } from './emitter.ts'
import { positivePow, each, lerpOf, zip } from './fold.ts'
import { coerce, constantOf, isConstantOf, splat, type Value } from './value.ts'

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
const same = (a: Value, b: Value) => a.type === b.type && a.code === b.code

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

/** `a` and `b` combined by `op`: a scalar is repeated to the other's width, two vectors of different
 *  widths are refused. A product by zero or one, a quotient of zero or by one, and any operation
 *  between constants are not written as code. */
export function arithmetic(e: Emitter, op: Operator, a: Value, b: Value): Value {
  const type = arithmeticType(a.type, b.type)
  const short = trivial(op, a, b, type)
  if (short) return short
  if (a.constant && b.constant) {
    const folded = zip(a.constant, b.constant, COMBINE[op])
    if (finite(folded)) return constantOf(type, folded)
  }
  const width = widthOf(type)
  return e.local(type, `(${splat(a, width).code} ${op} ${splat(b, width).code})`)
}

/** The smaller or the larger of `a` and `b`, which is made the type of `a`. */
export function extreme(e: Emitter, pick: 'min' | 'max', a: Value, b: Value): Value {
  if (!isNumeric(a.type)) throw graphError(`${pick} of a ${describeType(a.type)}`)
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
  if (same(x, y) || (x.constant && y.constant && same(ca, cb))) return { ...ca, type }
  if (isConstantOf(alpha, 0)) return { ...ca, type }
  if (isConstantOf(alpha, 1)) return { ...cb, type }
  if (widthOf(alpha.type) !== 1 && widthOf(alpha.type) !== width)
    throw graphError(`Lerp alpha has ${widthOf(alpha.type)} components against ${width}`)
  if (ca.constant && cb.constant && alpha.constant)
    return constantOf(type, lerpOf(ca.constant, cb.constant, alpha.constant))
  return e.local(type, `mix(${ca.code},${cb.code},${alpha.code})`)
}

/** `base` to the power `exponent` (a scalar), a negative base counting as zero. An exponent of 1 or
 *  0, or a base of 0, is not written as code. */
export function power(e: Emitter, base: Value, exponent: Value): Value {
  const type = base.type
  const width = widthOf(type)
  const ex = coerce(exponent, 'flex')
  if (ex.constant) {
    arithmeticType(base.type, exponent.type)
    const hit = isConstantOf(ex, 1)
      ? base
      : isConstantOf(ex, 0)
        ? constantOf('flex', [1])
        : isConstantOf(base, 0)
          ? constantOf('flex', [0])
          : undefined
    if (hit) return { ...splat(hit, width), type }
    if (base.constant)
      return constantOf(
        type,
        each(base.constant, (v) => positivePow(v, ex.constant![0])),
      )
  }
  const floor = splat(constantOf('flex', [0]), width)
  return e.local(type, `pow(max(${base.code},${floor.code}),${splat(ex, width).code})`)
}
