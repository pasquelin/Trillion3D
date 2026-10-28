import { EngineError } from '../../../contracts/cache.ts'

/**
 * The type of a value in a material graph. `flex` is a scalar written as a constant: it fits any
 * width (a node asks for a vector and gets the scalar repeated); `f1` to `f4` are exact widths;
 * `texture` is a texture object and `sparseVolume` a sparse volume texture object, which no arithmetic
 * accepts.
 */
export type ValueType = 'flex' | 'f1' | 'f2' | 'f3' | 'f4' | 'texture' | 'sparseVolume'

/** The error of a graph that cannot be built or compiled: `INVALID_MATERIAL`, with the node. */
export const graphError = (what: string, details: Record<string, unknown> = {}) =>
  new EngineError('INVALID_MATERIAL', `Material graph: ${what}`, details)

/** How many components a value holds: a `flex` scalar one, an object none. */
export const widthOf = (type: ValueType) =>
  type === 'flex' || type === 'f1' ? 1 : isObject(type) ? 0 : Number(type[1])

/** Whether `type` is an object (a texture or a sparse volume texture), not a number. */
const isObject = (type: ValueType) => type === 'texture' || type === 'sparseVolume'

/** The exact type of `width` components, 1 to 4. */
export const vectorType = (width: number): ValueType => `f${width}` as ValueType

/** Whether `type` is a number or a vector (not a texture). */
export const isNumeric = (type: ValueType) => !isObject(type)

/** A type as an error names it. */
export const describeType = (type: ValueType) =>
  type === 'flex'
    ? 'scalar constant'
    : type === 'texture'
      ? 'texture'
      : type === 'sparseVolume'
        ? 'sparse volume texture'
        : `float${type[1]}`

/** Refuses a texture where `what` (an operation) needs a number or a vector. */
export function assertNumeric(type: ValueType, what: string) {
  if (!isNumeric(type)) throw graphError(`${what} of a ${describeType(type)}`)
}

/**
 * The type of an operation between two values: the same type is itself; a scalar (`flex` or `f1`)
 * takes the other's type (the scalar is repeated); two vectors of different widths are refused.
 */
export function arithmeticType(a: ValueType, b: ValueType): ValueType {
  if (!isNumeric(a) || !isNumeric(b))
    throw graphError(
      `arithmetic on a non-numeric value (${describeType(a)} and ${describeType(b)})`,
    )
  if (a === b) return a
  if (a === 'flex' || a === 'f1') return b
  if (b === 'flex' || b === 'f1') return a
  throw graphError(`arithmetic between ${describeType(a)} and ${describeType(b)} is undefined`)
}
