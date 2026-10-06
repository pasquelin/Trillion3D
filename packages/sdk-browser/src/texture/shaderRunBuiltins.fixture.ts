// The WGSL built-ins and operators `shaderRun` (`shaderRun.fixture.ts`) runs a shader with, in
// JavaScript double precision.
import { cross } from '../../../sdk-core/src/math/primitives/vectorTuple.ts'

/** A vector: its components. A boolean vector holds booleans. */
export type Vec = Array<number | boolean>
/** A column-major 4×4 matrix. */
export class Mat {
  readonly m: readonly number[]
  readonly [column: number]: readonly number[]
  constructor(m: readonly number[]) {
    this.m = m
    for (let column = 0; column < 4; column++)
      Object.defineProperty(this, column, { value: m.slice(column * 4, column * 4 + 4) })
  }
}
type Value = number | boolean | Vec | Mat
type Scalar = number | boolean

const LETTERS = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 } as Record<string, number>

/** `f` applied component by component, scalars broadcast to the vectors' size. */
export const each =
  (f: (...parts: Scalar[]) => Scalar) =>
  (...args: Value[]): Value => {
    const size = args.find(Array.isArray)?.length
    if (size === undefined) return f(...(args as Scalar[]))
    return Array.from({ length: size }, (_, i) =>
      f(...args.map((arg) => (Array.isArray(arg) ? arg[i] : (arg as Scalar)))),
    )
  }

const n = (value: Scalar) => Number(value)
const SCALAR: Record<string, (a: number, b: number) => Scalar> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>>': (a, b) => a >>> b,
  '<<': (a, b) => (a << b) >>> 0,
  '&': (a, b) => (a & b) >>> 0,
  '|': (a, b) => (a | b) >>> 0,
  '^': (a, b) => (a ^ b) >>> 0,
}

/** A binary operator: a matrix times a vector, otherwise component-wise. */
function $b(op: string, a: Value, b: Value): Value {
  if (a instanceof Mat) {
    const v = b as number[]
    return [0, 1, 2, 3].map((row) => v.reduce((sum, x, col) => sum + a.m[col * 4 + row] * x, 0))
  }
  // Two scalars, the most of what a kernel's integer work runs: no vector to broadcast.
  if (!Array.isArray(a) && !Array.isArray(b)) return SCALAR[op](n(a as Scalar), n(b as Scalar))
  return each((x, y) => SCALAR[op](n(x), n(y)))(a, b)
}

/** A swizzle: one component, or a vector of several; on a structure, its member of that name. */
function $sw(value: Vec | Record<string, unknown>, name: string) {
  if (!Array.isArray(value)) return value[name]
  const parts = [...name].map((letter) => value[LETTERS[letter]])
  return parts.length === 1 ? parts[0] : parts
}

/** The JavaScript text assigning `value` to the translated `target`: through `$set` where the
 *  target is a swizzle's one component, through its pointer's `set` where it is `*p`. */
export const assigned = (target: string, value: string) => {
  const part = /^\$sw\((.*),"(\w)"\)$/.exec(target),
    pointer = /^\$deref\((.*)\)$/.exec(target)
  if (pointer) return `${pointer[1]}.set(${value})`
  return part ? `$set(${part[1]},"${part[2]}",${value})` : `${target}=${value}`
}

/** A copy of a value: a vector's or an array's elements, a structure's members (a matrix is never
 *  written in place). */
const $cp = <T>(value: T): T =>
  Array.isArray(value)
    ? (value.map($cp) as T)
    : value?.constructor === Object
      ? (Object.fromEntries(Object.entries(value).map(([k, v]) => [k, $cp(v)])) as T)
      : value

/** A vector constructor: its arguments flattened, one scalar splat to `size`. */
export const vector =
  (size: number, convert: (x: Scalar) => number) =>
  (...args: Value[]) => {
    const flat = (args as Array<Scalar | Vec>).flat().map(convert)
    return flat.length === 1 ? new Array<number>(size).fill(flat[0]) : flat
  }
const float = (x: Scalar) => Number(x)
const int = (x: Scalar) => Math.trunc(Number(x))

const numeric = (f: (...x: number[]) => number) => each((...x) => f(...x.map(n)))
/** A float's 32 bits as an unsigned integer, and back: `bitcast`. */
const WORD = new Float32Array(1),
  BITS = new Uint32Array(WORD.buffer)
const toBits = each((x) => ((WORD[0] = n(x)), BITS[0]))
const toFloat = each((x) => ((BITS[0] = n(x)), WORD[0]))
const vec = (value: Value) => value as number[]

/** A pointer: what `&x` gives an atomic (`shaderRun.fixture.ts`). */
type Ref = { get: () => number; set: (value: number) => void }
const swap = (p: Ref, value: number) => {
  const old = p.get()
  p.set(value)
  return old
}

export const builtins = {
  $b,
  $sw,
  $ref: (get: Ref['get'], set: Ref['set']): Ref => ({ get, set }),
  $deref: (p: Ref) => p.get(),
  // WGSL's values are copies: what a name holds is never another name's.
  $cp,
  // A vector's one component (`step.x=1`, `c.a=0`), or a structure's member of that name.
  $set: (base: Vec | Record<string, unknown>, name: string, value: Value) => {
    if (Array.isArray(base)) base[LETTERS[name]] = value as Scalar
    else base[name] = value
  },
  atomicAdd: (p: Ref, value: number) => swap(p, p.get() + value),
  atomicMax: (p: Ref, value: number) => swap(p, Math.max(p.get(), value)),
  atomicLoad: (p: Ref) => p.get(),
  atomicStore: (p: Ref, value: number) => void p.set(value),
  atomicOr: (p: Ref, value: number) => swap(p, (p.get() | value) >>> 0),
  atomicAnd: (p: Ref, value: number) => swap(p, (p.get() & value) >>> 0),
  countOneBits: each((x) => {
    let count = 0
    for (let v = n(x) >>> 0; v; v &= v - 1) count++
    return count
  }),
  // The lowest set bit's rank; all ones (-1 as `i32`) for zero.
  firstTrailingBit: each((x) => (n(x) ? 31 - Math.clz32(n(x) & -n(x)) : 0xffffffff)),
  vec2f: vector(2, float),
  vec3f: vector(3, float),
  vec4f: vector(4, float),
  vec2i: vector(2, int),
  vec4i: vector(4, int),
  vec2u: vector(2, (x) => int(x) >>> 0),
  vec3u: vector(3, (x) => int(x) >>> 0),
  vec4u: vector(4, (x) => int(x) >>> 0),
  bitcast_u32: toBits,
  bitcast_vec3u: toBits,
  bitcast_f32: toFloat,
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
  atan: numeric(Math.atan),
  sqrt: numeric(Math.sqrt),
  log: numeric(Math.log),
  log2: numeric(Math.log2),
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
  cross: (a: Value, b: Value) =>
    cross(vec(a) as Parameters<typeof cross>[0], vec(b) as Parameters<typeof cross>[1]),
  normalize: (v: Value) => vec(v).map((x) => x / Math.hypot(...vec(v))),
}
