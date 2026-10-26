import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  graphError,
  isNumeric,
  vectorType,
  widthOf,
  describeType,
  type ValueType,
} from '../../../../sdk-core/src/world/material/graph/valueType.ts'

/** A value the compiler holds: its type, the WGSL that reads it, and, for a constant, its
 *  components (one for a scalar). A texture value reads the texture's slot word. */
export interface Value {
  readonly type: ValueType
  readonly code: string
  readonly constant?: readonly number[]
}

/** The WGSL type of a value of `type`. */
export const wgslType = (type: ValueType) =>
  type === 'texture' ? 'u32' : widthOf(type) === 1 ? 'f32' : `vec${widthOf(type)}f`

/** The WGSL literal of `numbers` as a value of `type`. */
const literal = (type: ValueType, numbers: readonly number[]) =>
  widthOf(type) === 1 ? wgslF32(numbers[0]) : `${wgslType(type)}(${numbers.map(wgslF32).join(',')})`

/** The constant value `numbers` of `type`. */
export const constantOf = (type: ValueType, numbers: readonly number[]): Value => ({
  type,
  code: literal(type, numbers),
  constant: numbers.map(Math.fround),
})

/** The components of `numbers` repeated to `width` when it holds one. */
export const widen = (numbers: readonly number[], width: number) =>
  numbers.length === width ? numbers : Array<number>(width).fill(numbers[0])

/** Whether `x` and `y` are one type written as the same code. */
export const sameValue = (x: Value, y: Value) => x.type === y.type && x.code === y.code

/** Whether `value` is a constant whose every component is `x`. */
export const isConstantOf = (value: Value, x: number) => !!value.constant?.every((c) => c === x)

/** A scalar repeated to `width` components; a vector of that width, or `width` 1, unchanged. */
export function splat(value: Value, width: number): Value {
  if (width === 1 || widthOf(value.type) === width) return value
  const type = vectorType(width)
  if (value.constant) return constantOf(type, widen(value.constant, width))
  return { type, code: `${wgslType(type)}(${value.code})` }
}

/** What a cast may do: repeat a scalar, drop components, fill missing ones with zeros. */
interface CastFlags {
  readonly replicate?: boolean
  readonly truncate?: boolean
  readonly appendZeros?: boolean
}

const MASKS = ['', 'x', 'xy', 'xyz', 'xyzw']

/** `value` as `dest`, by the flags given; the casts a flag does not allow are errors. */
function cast(value: Value, dest: ValueType, flags: CastFlags): Value {
  const { type } = value
  if (type === dest) return value
  if (!isNumeric(type) || !isNumeric(dest))
    throw graphError(`cannot cast ${describeType(type)} to ${describeType(dest)}`)
  const from = widthOf(type)
  const to = widthOf(dest)
  const repeat = flags.replicate && from === 1
  if (!repeat && !flags.appendZeros && to > from)
    throw graphError(
      `cannot cast from smaller type ${describeType(type)} to larger ${describeType(dest)}`,
    )
  if (!repeat && !flags.truncate && to < from)
    throw graphError(
      `cannot cast from larger type ${describeType(type)} to smaller ${describeType(dest)}`,
    )
  if (from === to) return { ...value, type: dest }
  if (repeat) return { ...splat(value, to), type: dest }
  const kept = Math.min(from, to)
  if (value.constant)
    return constantOf(dest, [...value.constant.slice(0, kept), ...Array<number>(to - kept).fill(0)])
  const head = kept === from ? value.code : `${value.code}.${MASKS[kept]}`
  const zeros = Array<string>(to - kept).fill('0.0')
  return { type: dest, code: to === 1 ? head : `${wgslType(dest)}(${[head, ...zeros].join(',')})` }
}

/** `value` made the type of an operand of an operation that asks for `dest`: a scalar is repeated,
 *  and a vector narrows only to a scalar. */
export const coerce = (value: Value, dest: ValueType): Value =>
  cast(value, dest, { replicate: true, truncate: widthOf(dest) === 1 })

/** `value` made the type of an output: a scalar constant is repeated, anything else cast with
 *  every flag. */
export const forceCast = (value: Value, dest: ValueType): Value =>
  value.type === 'flex' && isNumeric(dest)
    ? { ...splat(value, widthOf(dest)), type: dest }
    : cast(value, dest, { replicate: true, truncate: true, appendZeros: true })
