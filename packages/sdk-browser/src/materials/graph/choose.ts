import {
  arithmeticType,
  graphError,
  isNumeric,
  widthOf,
} from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import type { Emitter } from './emitter.ts'
import { forceCast, sameValue, splat, type Value } from './value.ts'

/** The arguments of a choice between three results by the comparison of `a` with `b`. */
export interface Choice {
  readonly a: Value
  readonly b: Value
  readonly greater: Value
  readonly equal?: Value
  readonly less: Value
  readonly threshold: Value
}

/**
 * The result of comparing `a` with `b`: `greater` where `a` is at least `b`, `less` where below it,
 * `equal` where they differ by no more than the threshold (when `equal` is wired). The three results
 * are made the type they share. A comparison of constants chooses its result without code; results
 * that are the same value are the result.
 */
export function ifValue(e: Emitter, c: Choice): Value {
  if (!isNumeric(c.a.type) || !isNumeric(c.b.type))
    throw graphError('If inputs A and B must be numbers.')
  if (sameValue(c.greater, c.less) && (!c.equal || sameValue(c.greater, c.equal))) return c.greater
  const shared = arithmeticType(c.greater.type, c.less.type)
  const type = c.equal ? arithmeticType(shared, c.equal.type) : shared
  const compared = arithmeticType(c.a.type, c.b.type)
  const width = widthOf(compared)
  if (width > 1 && widthOf(type) !== width)
    throw graphError(`If compares ${width} components but chooses ${widthOf(type)}`)
  const [gt, lt] = [forceCast(c.greater, type), forceCast(c.less, type)]
  const a = splat(c.a, width)
  const b = splat(c.b, width)
  if (a.constant && b.constant && width === 1 && !c.equal)
    return a.constant[0] >= b.constant[0] ? gt : lt
  const ordered = `select(${lt.code},${gt.code},${a.code}>=${b.code})`
  if (!c.equal) return e.local(type, ordered)
  const near = `abs(${a.code}-${b.code})<=${splat(c.threshold, width).code}`
  return e.local(type, `select(${ordered},${forceCast(c.equal, type).code},${near})`)
}
