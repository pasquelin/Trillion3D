import {
  arithmeticType,
  graphError,
  isNumeric,
  vectorType,
  widthOf,
  describeType,
} from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import type { Emitter } from './emitter.ts'
import { crossOf, dotOf, each, lengthOf } from './fold.ts'
import { coerce, constantOf, isConstantOf, splat, type Value } from './value.ts'

/** A function applied to each component: its shader name and its value on a number. */
export interface ComponentFunction {
  readonly name: string
  readonly of: (x: number) => number
}

/** The functions of one component that keep the type of their input. */
export const COMPONENT_FUNCTIONS = {
  abs: { name: 'abs', of: Math.abs },
  floor: { name: 'floor', of: Math.floor },
  ceil: { name: 'ceil', of: Math.ceil },
  frac: { name: 'fract', of: (x: number) => x - Math.floor(x) },
  sine: { name: 'sin', of: Math.sin },
  cosine: { name: 'cos', of: Math.cos },
} as const satisfies Record<string, ComponentFunction>

/** `fn` of each component of `x`, written as code unless `x` is a constant. */
export function componentwise(e: Emitter, fn: ComponentFunction, x: Value): Value {
  if (!isNumeric(x.type)) throw graphError(`${fn.name} of a ${describeType(x.type)}`)
  if (x.constant) return constantOf(x.type, each(x.constant, fn.of))
  return e.local(x.type, `${fn.name}(${x.code})`)
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

/** `x` scaled to length 1. */
export function normalize(e: Emitter, x: Value): Value {
  if (!isNumeric(x.type)) throw graphError(`normalize of a ${describeType(x.type)}`)
  if (x.constant) {
    const length = lengthOf(x.constant)
    return constantOf(
      x.type,
      each(x.constant, (v) => v / length),
    )
  }
  return e.local(
    x.type,
    widthOf(x.type) === 1 ? `(${x.code}/abs(${x.code}))` : `normalize(${x.code})`,
  )
}

/** The length of `x`. */
export function length(e: Emitter, x: Value): Value {
  if (!isNumeric(x.type)) throw graphError(`length of a ${describeType(x.type)}`)
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
