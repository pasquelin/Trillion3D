// The WGSL built-ins and operators `shaderRun` (`shaderRun.fixture.ts`) runs a shader with, in
// JavaScript double precision.
import { f32Bits, fromF32Bits } from '../../../../math/src/float/bits.ts'
import { cross } from '../../../../math/src/vector/vectorTuple.ts'
import { fromHalf, toHalf } from '../../../../math/src/float/half.ts'
import { SCALAR } from './shaderRunOperators.fixture.ts'
import { Mat, Mat3, matrixProduct } from './shaderRunMatrix.fixture.ts'
import { resources } from './shaderRunResources.fixture.ts'

/** A vector: its components. A boolean vector holds booleans. */
export type Vec = Array<number | boolean>
type Value = number | boolean | Vec | Mat | Mat3
type Scalar = number | boolean

const LETTERS = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 } as Record<string, number>

/** `f` applied component by component, scalars broadcast to the vectors' size: plain loops, so a
 *  kernel run as JavaScript makes one array a result and nothing a component. */
export const each =
  (f: (...parts: Scalar[]) => Scalar) =>
  (...args: Value[]): Value => {
    let size = -1
    for (const arg of args)
      if (Array.isArray(arg)) {
        size = arg.length
        break
      }
    if (size < 0) return f(...(args as Scalar[]))
    const out = new Array<Scalar>(size)
    const parts = new Array<Scalar>(args.length)
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < args.length; k++) {
        const arg = args[k]
        parts[k] = Array.isArray(arg) ? (arg[i] as Scalar) : (arg as Scalar)
      }
      out[i] = f(...parts)
    }
    return out
  }

const n = (value: Scalar) => Number(value)

/** Whether `value` is a matrix (`shaderRunMatrix.fixture.ts`). */
const isMatrix = (value: Value) => value instanceof Mat || value instanceof Mat3

/** A binary operator: a matrix times a vector, otherwise component-wise. */
function $b(op: string, a: Value, b: Value): Value {
  const apply = SCALAR[op]
  // Two numbers, the most of what a kernel runs: no matrix to multiply, no vector to broadcast.
  if (typeof a === 'number' && typeof b === 'number') return apply(a, b)
  const left = Array.isArray(a),
    right = Array.isArray(b)
  if (isMatrix(a) || isMatrix(b)) {
    // A matrix takes part in the products `matrixProduct` makes alone — a 4×4 by a 4×4, a matrix
    // by a vector and a vector by a matrix —: anything else on one is refused, not run.
    const vector = left || right
    const product =
      op === '*' && (vector || (a instanceof Mat && b instanceof Mat))
        ? matrixProduct(a, b)
        : undefined
    if (product) return product
    throw new Error(`shaderRun runs no '${op}' on these matrix operands`)
  }
  if (!left && !right) return apply(n(a as Scalar), n(b as Scalar))
  const size = ((left ? a : b) as Vec).length
  const out = new Array<number | boolean>(size)
  for (let i = 0; i < size; i++)
    out[i] = apply(
      n(left ? (a as Vec)[i] : (a as Scalar)),
      n(right ? (b as Vec)[i] : (b as Scalar)),
    )
  return out
}

/** A swizzle: one component, or a vector of several; on a structure, its member of that name. */
function $sw(value: Vec | Record<string, unknown>, name: string) {
  if (!Array.isArray(value)) return value[name]
  if (name.length === 1) return value[LETTERS[name]]
  const parts = new Array<number | boolean>(name.length)
  for (let i = 0; i < name.length; i++) parts[i] = value[LETTERS[name[i]]]
  return parts
}

/** The JavaScript text assigning `value` to the translated `target`: through `$set` where the
 *  target is a swizzle's one component, through its pointer's `set` where it is `*p`. */
export const assigned = (target: string, value: string) => {
  const part = /^\$sw\((.*),"(\w)"\)$/.exec(target),
    pointer = /^\$deref\((.*)\)$/.exec(target)
  if (pointer) return `${pointer[1]}.set(${value})`
  return part ? `$set(${part[1]},"${part[2]}",${value})` : `${target}=${value}`
}

/** A copy of a value: a vector's or an array's elements, a structure's members, a matrix's
 *  columns (one is written column by column). */
export const $cp = <T>(value: T): T => {
  // A scalar is its own copy: most of what a kernel assigns.
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    return value.map($cp) as T
  }
  if (value instanceof Mat) return new Mat(value.m) as T
  if (value instanceof Mat3) return new Mat3(value.columns) as T
  return value.constructor === Object
    ? (Object.fromEntries(Object.entries(value).map(([k, v]) => [k, $cp(v)])) as T)
    : value
}

/** A vector constructor: its arguments flattened, one scalar splat to `size`. */
export const vector =
  (size: number, convert: (x: Scalar) => number) =>
  (...args: Value[]) => {
    const flat: number[] = []
    for (const arg of args as Array<Scalar | Vec>)
      if (Array.isArray(arg)) for (const part of arg) flat.push(convert(part))
      else flat.push(convert(arg))
    return flat.length === 1 ? new Array<number>(size).fill(flat[0]) : flat
  }
const float = (x: Scalar) => Number(x)
const int = (x: Scalar) => Math.trunc(Number(x))

const numeric = (f: (...x: number[]) => number) => each((...x) => f(...x.map(n)))
/** A float's 32 bits as an unsigned integer, and back: `bitcast`. */
const toBits = each((x) => f32Bits(n(x)))
const toFloat = each((x) => fromF32Bits(n(x)))
const vec = (value: Value) => value as number[]

export const builtins = {
  $b,
  $sw,
  ...resources,
  // WGSL's values are copies: what a name holds is never another name's.
  $cp,
  // A vector's one component (`step.x=1`, `c.a=0`), or a structure's member of that name.
  $set: (base: Vec | Record<string, unknown>, name: string, value: Value) => {
    if (Array.isArray(base)) base[LETTERS[name]] = value as Scalar
    else base[name] = value
  },
  countOneBits: each((x) => {
    let count = 0
    for (let v = n(x) >>> 0; v; v &= v - 1) count++
    return count
  }),
  countLeadingZeros: each((x) => Math.clz32(n(x))),
  // The lowest set bit's rank; all ones (-1 as `i32`) for zero.
  firstTrailingBit: each((x) => (n(x) ? 31 - Math.clz32(n(x) & -n(x)) : 0xffffffff)),
  // The highest bit's rank that differs from the sign, a negative `i32` read through its
  // complement; all ones for none (0, or an `i32` −1).
  firstLeadingBit: each((x) => {
    const v = n(x) < 0 ? ~n(x) : n(x)
    return v ? 31 - Math.clz32(v) : 0xffffffff
  }),
  array: (...values: unknown[]) => values.map($cp),
  mat3x3f: (...columns: number[][]) => new Mat3(columns),
  mat4x4f: (...values: Array<number | number[]>) => new Mat(values.flat()),
  vec2f: vector(2, float),
  vec3f: vector(3, float),
  vec4f: vector(4, float),
  vec2i: vector(2, int),
  vec3i: vector(3, int),
  vec4i: vector(4, int),
  vec2u: vector(2, (x) => int(x) >>> 0),
  vec3u: vector(3, (x) => int(x) >>> 0),
  vec4u: vector(4, (x) => int(x) >>> 0),
  vec2b: vector(2, (x) => Number(Boolean(x))),
  vec3b: vector(3, (x) => Number(Boolean(x))),
  vec4b: vector(4, (x) => Number(Boolean(x))),
  bitcast_u32: toBits,
  bitcast_vec3u: toBits,
  bitcast_vec4u: toBits,
  bitcast_f32: toFloat,
  bitcast_vec3f: toFloat,
  bitcast_vec4f: toFloat,
  f32: each(float),
  i32: each(int),
  u32: each((x) => int(x) >>> 0),
  min: numeric(Math.min),
  max: numeric(Math.max),
  clamp: numeric((x, lo, hi) => Math.min(Math.max(x, lo), hi)),
  saturate: numeric((x) => Math.min(Math.max(x, 0), 1)),
  abs: numeric(Math.abs),
  floor: numeric(Math.floor),
  fract: numeric((x) => x - Math.floor(x)),
  sign: numeric(Math.sign),
  ceil: numeric(Math.ceil),
  // WGSL rounds half to even: only whole numbers and near-whole ones are rounded here.
  round: numeric(Math.round),
  sin: numeric(Math.sin),
  cos: numeric(Math.cos),
  asin: numeric(Math.asin),
  acos: numeric(Math.acos),
  atan: numeric(Math.atan),
  atan2: numeric(Math.atan2),
  sqrt: numeric(Math.sqrt),
  inverseSqrt: numeric((x) => 1 / Math.sqrt(x)),
  // Two halves in one word, the first in the low bits, and back.
  pack2x16float: (v: Value) => (toHalf(vec(v)[0]) | (toHalf(vec(v)[1]) << 16)) >>> 0,
  unpack2x16float: (word: Value) => [
    fromHalf(n(word as Scalar) & 0xffff),
    fromHalf(n(word as Scalar) >>> 16),
  ],
  log: numeric(Math.log),
  log2: numeric(Math.log2),
  exp: numeric(Math.exp),
  exp2: numeric((x) => 2 ** x),
  pow: numeric((x, y) => x ** y),
  mix: numeric((a, b, t) => a + (b - a) * t),
  smoothstep: numeric((e0, e1, x) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
    return t * t * (3 - 2 * t)
  }),
  select: each((no, yes, when) => (when ? yes : no)),
  all: (v: Value) => (Array.isArray(v) ? v.every(Boolean) : !!v),
  any: (v: Value) => (Array.isArray(v) ? v.some(Boolean) : !!v),
  dot: (a: Value, b: Value) => vec(a).reduce((sum, x, i) => sum + x * vec(b)[i], 0),
  length: (v: Value) => (Array.isArray(v) ? Math.hypot(...vec(v)) : Math.abs(n(v as Scalar))),
  distance: (a: Value, b: Value) => Math.hypot(...vec(a).map((x, i) => x - vec(b)[i])),
  reflect: (i: Value, normal: Value) => {
    const d = 2 * vec(i).reduce((sum, x, k) => sum + x * vec(normal)[k], 0)
    return vec(i).map((x, k) => x - d * vec(normal)[k])
  },
  refract: (i: Value, normal: Value, eta: Value) => {
    const d = vec(i).reduce((sum, x, k) => sum + x * vec(normal)[k], 0)
    const e = n(eta as Scalar)
    const k = 1 - e * e * (1 - d * d)
    return vec(i).map((x, c) => (k < 0 ? 0 : e * x - (e * d + Math.sqrt(k)) * vec(normal)[c]))
  },
  faceForward: (e1: Value, e2: Value, e3: Value) =>
    vec(e2).reduce((sum, x, k) => sum + x * vec(e3)[k], 0) < 0 ? vec(e1) : vec(e1).map((x) => -x),
  cross: (a: Value, b: Value) =>
    cross(vec(a) as Parameters<typeof cross>[0], vec(b) as Parameters<typeof cross>[1]),
  normalize: (v: Value) => vec(v).map((x) => x / Math.hypot(...vec(v))),
}
