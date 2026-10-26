import {
  arithmeticType,
  graphError,
  isNumeric,
  vectorType,
  widthOf,
  describeType,
  assertNumeric,
} from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { fract } from '../../../../math/src/scalar/reals.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import type { Emitter } from './emitter.ts'
import { crossOf, dotOf, each, lengthOf, normalizedOf, single } from './fold.ts'
import { coerce, constantOf, isConstantOf, splat, type Value } from './value.ts'

/** A function applied to each component: its shader name, its value on a number and, where the
 *  shader has no function of that name, the code that writes it (given whether the operand is the
 *  same at every pixel). */
export interface ComponentFunction {
  readonly name: string
  readonly of: (x: number) => number
  readonly code?: (operand: string, uniform: boolean) => string
}

const LOG10_OF_2 = wgslF32(Math.log10(2))
const LN_10_RECIPROCAL = single(1 / single(Math.log(10)))

/** The functions of one component that keep the type of their input. The rounding of a value the
 *  pixels share goes up at a half, as a sum with a half and a floor do; that of one that varies goes
 *  to the even whole number, as the shader's own does. */
export const COMPONENT_FUNCTIONS = {
  abs: { name: 'abs', of: Math.abs },
  floor: { name: 'floor', of: Math.floor },
  ceil: { name: 'ceil', of: Math.ceil },
  frac: { name: 'fract', of: fract },
  sine: { name: 'sin', of: Math.sin },
  cosine: { name: 'cos', of: Math.cos },
  tangent: { name: 'tan', of: Math.tan },
  sqrt: { name: 'sqrt', of: Math.sqrt },
  exp: { name: 'exp', of: Math.exp },
  exp2: { name: 'exp2', of: (x) => 2 ** x },
  log: { name: 'log', of: Math.log },
  log2: { name: 'log2', of: Math.log2 },
  log10: {
    name: 'log10',
    of: (x) => single(Math.log(x)) * LN_10_RECIPROCAL,
    code: (x) => `(log2(${x})*${LOG10_OF_2})`,
  },
  sign: { name: 'sign', of: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0) },
  round: {
    name: 'round',
    of: (x) => Math.floor(single(x + 0.5)),
    code: (x, uniform) => (uniform ? `floor(${x}+0.5)` : `round(${x})`),
  },
} as const satisfies Record<string, ComponentFunction>

/** `fn` of each component of `x`, written as code unless `x` is a constant; a constant that has no
 *  finite value in it (the root of a negative number, the logarithm of zero) is refused, as no
 *  shader literal and no constant expression holds one. */
export function componentwise(e: Emitter, fn: ComponentFunction, x: Value): Value {
  assertNumeric(x.type, fn.name)
  if (x.constant) {
    const folded = each(x.constant, fn.of)
    if (!folded.every(Number.isFinite))
      throw graphError(`${fn.name} of ${x.constant.join(', ')} has no finite value`)
    return constantOf(x.type, folded)
  }
  return e.local(x.type, fn.code?.(x.code, e.uniform(x)) ?? `${fn.name}(${x.code})`)
}

/** The dot product: the narrower operand is made the width of the other (a scalar repeated, a
 *  vector cut to the narrower's width), a zero operand gives the constant 0. */
export function dot(e: Emitter, a: Value, b: Value): Value {
  if (isConstantOf(a, 0) || isConstantOf(b, 0)) return constantOf('flex', [0])
  const toB = a.type === 'flex' || (b.type !== 'flex' && widthOf(a.type) > widthOf(b.type))
  const ca = toB ? coerce(a, b.type) : a
  const cb = toB ? b : coerce(b, a.type)
  if (ca.constant && cb.constant) return constantOf('flex', [dotOf(ca.constant, cb.constant)])
  return e.local(
    'flex',
    widthOf(ca.type) === 1 ? `(${ca.code}*${cb.code})` : `dot(${ca.code},${cb.code})`,
  )
}

/** The cross product of two vectors of three components. */
export function cross(e: Emitter, a: Value, b: Value): Value {
  const type = arithmeticType(a.type, b.type)
  const valid = widthOf(type) === 3
  if (valid && (isConstantOf(a, 0) || isConstantOf(b, 0))) return constantOf(type, [0, 0, 0])
  if (!valid) throw graphError('Cross product requires 3-component vector input.')
  const ca = coerce(a, 'f3')
  const cb = coerce(b, 'f3')
  if (ca.constant && cb.constant) return constantOf('f3', crossOf(ca.constant, cb.constant))
  return e.local('f3', `cross(${ca.code},${cb.code})`)
}

/** `x` scaled to length 1, by a plain normalisation on every path: a zero vector is not a number. A
 *  scalar is divided by its magnitude (its sign), the shader having no scalar normalisation. A constant
 *  that does not fold to a finite number is left to the shader. */
export function normalize(e: Emitter, x: Value): Value {
  assertNumeric(x.type, 'normalize')
  if (x.constant) {
    const folded = normalizedOf(x.constant)
    if (folded.every(Number.isFinite)) return constantOf(x.type, folded)
  }
  const operand = x.constant ? e.local(x.type, x.code) : x
  if (widthOf(x.type) === 1) return e.local(x.type, `(${operand.code}/abs(${operand.code}))`)
  return e.local(x.type, `normalize(${operand.code})`)
}

/** The length of `x`. */
export function length(e: Emitter, x: Value): Value {
  assertNumeric(x.type, 'length')
  if (x.constant) return constantOf('flex', [lengthOf(x.constant)])
  return e.local('flex', `length(${x.code})`)
}

/** `a` then `b` as one vector of four components at most. */
export function append(e: Emitter, a: Value, b: Value): Value {
  const width = widthOf(a.type) + widthOf(b.type)
  if (!isNumeric(a.type) || !isNumeric(b.type) || width > 4)
    throw graphError(`Can't append ${describeType(b.type)} to ${describeType(a.type)}`)
  const type = vectorType(width)
  if (a.constant && b.constant) return constantOf(type, [...a.constant, ...b.constant])
  return e.local(type, `vec${width}f(${a.code},${b.code})`)
}

/** The components of `x` named in `mask` (letters of 'rgba'): a scalar constant offers all four, a
 *  vector the ones it has. */
export function mask(e: Emitter, x: Value, picked: string): Value {
  const offered = x.type === 'flex' ? 4 : widthOf(x.type)
  const at = [...'rgba'].flatMap((c, i) => (picked.includes(c) ? [i] : []))
  if (!isNumeric(x.type) || !at.length || at.some((i) => i >= offered))
    throw graphError(
      `Not enough components in ${describeType(x.type)} for component mask ${picked}`,
    )
  const type = at.length === 1 ? 'flex' : vectorType(at.length)
  if (x.type === 'flex') return { ...splat(x, at.length), type }
  if (x.constant)
    return constantOf(
      type,
      at.map((i) => x.constant![i]),
    )
  if (at.length === widthOf(x.type) && at.every((v, i) => v === i)) return { ...x, type }
  return e.local(type, `${x.code}.${at.map((i) => 'xyzw'[i]).join('')}`)
}
