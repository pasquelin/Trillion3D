// The WGSL built-ins and operators `shaderRun` (`shaderRun.fixture.ts`) runs a shader with, in
// JavaScript double precision.

/** A vector: its components. A boolean vector holds booleans. */
export type Vec = Array<number | boolean>;
/** A column-major 4×4 matrix. */
export class Mat {
  readonly m: readonly number[];
  constructor(m: readonly number[]) {
    this.m = m;
  }
}
type Value = number | boolean | Vec | Mat;
type Scalar = number | boolean;

const LETTERS = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 } as Record<string, number>;

/** `f` applied component by component, scalars broadcast to the vectors' size. */
const each =
  (f: (...parts: Scalar[]) => Scalar) =>
  (...args: Value[]): Value => {
    const size = args.find(Array.isArray)?.length;
    if (size === undefined) return f(...(args as Scalar[]));
    return Array.from({ length: size }, (_, i) =>
      f(...args.map((arg) => (Array.isArray(arg) ? arg[i] : (arg as Scalar)))),
    );
  };

const n = (value: Scalar) => Number(value);
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
};

/** A binary operator: a matrix times a vector, otherwise component-wise. */
function $b(op: string, a: Value, b: Value): Value {
  if (a instanceof Mat) {
    const v = b as number[];
    return [0, 1, 2, 3].map((row) => v.reduce((sum, x, col) => sum + a.m[col * 4 + row] * x, 0));
  }
  return each((x, y) => SCALAR[op](n(x), n(y)))(a, b);
}

/** A swizzle: one component, or a vector of several. */
function $sw(value: Vec, name: string) {
  const parts = [...name].map((letter) => value[LETTERS[letter]]);
  return parts.length === 1 ? parts[0] : parts;
}

/** A vector constructor: its arguments flattened, one scalar splat to `size`. */
const vector =
  (size: number, convert: (x: Scalar) => number) =>
  (...args: Value[]) => {
    const flat = (args as Array<Scalar | Vec>).flat().map(convert);
    return flat.length === 1 ? new Array<number>(size).fill(flat[0]) : flat;
  };
const float = (x: Scalar) => Number(x);
const int = (x: Scalar) => Math.trunc(Number(x));

const numeric = (f: (...x: number[]) => number) => each((...x) => f(...x.map(n)));
const vec = (value: Value) => value as number[];

export const builtins = {
  $b,
  $sw,
  vec2f: vector(2, float),
  vec3f: vector(3, float),
  vec4f: vector(4, float),
  vec2i: vector(2, int),
  f32: each(float),
  i32: each(int),
  u32: each((x) => int(x) >>> 0),
  min: numeric(Math.min),
  max: numeric(Math.max),
  clamp: numeric((x, lo, hi) => Math.min(Math.max(x, lo), hi)),
  saturate: numeric((x) => Math.min(Math.max(x, 0), 1)),
  abs: numeric(Math.abs),
  floor: numeric(Math.floor),
  sin: numeric(Math.sin),
  sqrt: numeric(Math.sqrt),
  log2: numeric(Math.log2),
  exp2: numeric((x) => 2 ** x),
  select: each((no, yes, when) => (when ? yes : no)),
  all: (v: Value) => (Array.isArray(v) ? v.every(Boolean) : !!v),
  any: (v: Value) => (Array.isArray(v) ? v.some(Boolean) : !!v),
  dot: (a: Value, b: Value) => vec(a).reduce((sum, x, i) => sum + x * vec(b)[i], 0),
  length: (v: Value) => (Array.isArray(v) ? Math.hypot(...vec(v)) : Math.abs(n(v as Scalar))),
};
