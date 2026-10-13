// `shaderRun`'s built-ins (`../texture/shaderRunBuiltins.fixture.ts`) in IEEE-754 binary32, the
// precision a GPU shades in: every operation rounds once, as a GPU that neither fuses nor
// reassociates would; a literal rounds where it is read. Transcendentals are correctly rounded,
// tighter than WGSL's bounds (`atan2` 4096 ULP, `inverseSqrt` 2 ULP): the errors measured with this
// scope are those of the arithmetic, a lower bound of a device's.
import {
  builtins,
  each as broadcast,
  vector,
  type Vec,
} from '../texture/shaderRunBuiltins.fixture.ts'
type Value = number | boolean | Vec
const rounded = (v: Value): Value =>
  typeof v === 'number' ? Math.fround(v) : Array.isArray(v) ? v.map((x) => rounded(x) as number) : v
const num = (v: Value) => v as number[]
const dot = (a: Value, b: Value) =>
  num(a).reduce(
    (sum, x, i) => (i ? Math.fround(sum + Math.fround(x * num(b)[i])) : Math.fround(x * num(b)[0])),
    0,
  )
/** `fn` component by component, scalars broadcast, every result rounded. */
const each = (fn: (...x: number[]) => number) =>
  broadcast((...x) => Math.fround(fn(...(x as number[]))))

export const F32_SCOPE = {
  $b: (op: string, a: Value, b: Value) => {
    const out = builtins.$b(op, rounded(a), rounded(b)) as Value
    return '+-*/%'.includes(op) ? rounded(out) : out
  },
  vec3f: vector(3, (x) => Math.fround(Number(x))),
  vec4f: vector(4, (x) => Math.fround(Number(x))),
  dot,
  cross: (a: Value, b: Value) => {
    const [x, y] = [num(a), num(b)]
    return [1, 2, 0].map((i, k) => {
      const j = (k + 2) % 3
      return Math.fround(Math.fround(x[i] * y[j]) - Math.fround(x[j] * y[i]))
    })
  },
  length: (v: Value) => Math.fround(Math.sqrt(dot(v, v))),
  normalize: (v: Value) => {
    const r = Math.fround(1 / Math.sqrt(dot(v, v)))
    return num(v).map((x) => Math.fround(x * r))
  },
  sqrt: each(Math.sqrt),
  inverseSqrt: each((x) => 1 / Math.sqrt(x)),
  atan2: each(Math.atan2),
  abs: each(Math.abs),
  sign: each(Math.sign),
  max: each(Math.max),
  clamp: each((x, lo, hi) => Math.min(Math.max(x, lo), hi)),
  mix: each((a, b, t) => Math.fround(a + Math.fround(Math.fround(b - a) * t))),
  pow: each((x, y) => x ** y),
}
